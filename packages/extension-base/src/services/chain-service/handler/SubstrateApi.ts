// Copyright 2019-2022 @subwallet/extension-base authors & contributors
// SPDX-License-Identifier: Apache-2.0

import '@polkadot/types-augment';

import { options as acalaOptions } from '@acala-network/api';
import { rpc as oakRpc, types as oakTypes } from '@oak-foundation/types';
import { MetadataItem } from '@subwallet/extension-base/background/KoniTypes';
import { _API_OPTIONS_CHAIN_GROUP, API_AUTO_CONNECT_MS, API_CONNECT_TIMEOUT } from '@subwallet/extension-base/services/chain-service/constants';
import { getSubstrateConnectProvider } from '@subwallet/extension-base/services/chain-service/handler/light-client';
import { DEFAULT_AUX } from '@subwallet/extension-base/services/chain-service/handler/SubstrateChainHandler';
import { _ApiOptions } from '@subwallet/extension-base/services/chain-service/handler/types';
import { _ChainConnectionStatus, _SubstrateApi, _SubstrateDefaultFormatBalance } from '@subwallet/extension-base/services/chain-service/types';
import { createPromiseHandler, PromiseHandler } from '@subwallet/extension-base/utils/promise';
import { goldbergRpc, goldbergTypes, spec as availSpec } from 'avail-js-sdk';
import { BehaviorSubject } from 'rxjs';

import { ApiPromise, WsProvider } from '@polkadot/api';
import { SubmittableExtrinsicFunction } from '@polkadot/api/promise/types';
import { ApiOptions } from '@polkadot/api/types';
import { typesBundle } from '@polkadot/apps-config/api';
import { ProviderInterface } from '@polkadot/rpc-provider/types';
import { TypeRegistry } from '@polkadot/types/create';
import { Registry } from '@polkadot/types/types';
import { formatBalance } from '@polkadot/util';

import { Dedot } from "dedot";
import { CheckAppId, ProviderInterfaceAdapter } from "@subwallet/extension-base/services/chain-service/handler/dedot";
import { RuntimeApis } from "@dedot/specs";

export class SubstrateApi implements _SubstrateApi {
  chainSlug: string;
  api!: ApiPromise;
  dedot!: Dedot;
  providerName?: string;
  provider!: ProviderInterface;
  apiUrl: string;
  metadata?: MetadataItem;

  useLightClient = false;
  isApiReady = false;
  isApiReadyOnce = false;
  apiError?: string;
  private handleApiReady: PromiseHandler<_SubstrateApi>;
  public readonly isApiConnectedSubject = new BehaviorSubject(false);
  public readonly connectionStatusSubject = new BehaviorSubject(_ChainConnectionStatus.DISCONNECTED);
  get isApiConnected (): boolean {
    return this.isApiConnectedSubject.getValue();
  }

  substrateRetry = 0;

  get connectionStatus (): _ChainConnectionStatus {
    return this.connectionStatusSubject.getValue();
  }

  private updateConnectionStatus (status: _ChainConnectionStatus): void {
    const isConnected = status === _ChainConnectionStatus.CONNECTED;

    if (isConnected !== this.isApiConnectedSubject.value) {
      this.isApiConnectedSubject.next(isConnected);
    }

    if (status !== this.connectionStatusSubject.value) {
      this.connectionStatusSubject.next(status);
    }
  }

  apiDefaultTx?: SubmittableExtrinsicFunction;
  apiDefaultTxSudo?: SubmittableExtrinsicFunction;
  defaultFormatBalance?: _SubstrateDefaultFormatBalance;

  registry: Registry;
  specName = '';
  specVersion = '';
  systemChain = '';
  systemName = '';
  systemVersion = '';

  private createProvider (apiUrl: string): ProviderInterface {
    if (apiUrl.startsWith('light://')) {
      this.useLightClient = true;

      return getSubstrateConnectProvider(apiUrl.replace('light://substrate-connect/', ''));
    } else {
      this.useLightClient = true;

      return new WsProvider(apiUrl, API_AUTO_CONNECT_MS, {}, API_CONNECT_TIMEOUT);
    }
  }

  private createApi (provider: ProviderInterface, externalApiPromise?: ApiPromise): [ApiPromise, Dedot] {
    const apiOption: ApiOptions = {
      provider,
      typesBundle,
      registry: this.registry,
      noInitWarn: true
    };

    if (this.metadata) {
      const metadata = this.metadata;

      apiOption.metadata = {
        [`${metadata.genesisHash}-${metadata.specVersion}`]: metadata.hexValue
      };
    }

    this.updateConnectionStatus(_ChainConnectionStatus.CONNECTING);

    let api: ApiPromise;

    if (externalApiPromise) {
      api = externalApiPromise;
    } else if (_API_OPTIONS_CHAIN_GROUP.acala.includes(this.chainSlug)) {
      api = new ApiPromise(acalaOptions({ provider, noInitWarn: true }));
    } else if (_API_OPTIONS_CHAIN_GROUP.turing.includes(this.chainSlug)) {
      api = new ApiPromise({
        provider,
        rpc: oakRpc,
        types: oakTypes,
        noInitWarn: true
      });
    } else if (_API_OPTIONS_CHAIN_GROUP.avail.includes(this.chainSlug)) {
      api = new ApiPromise({
        provider,
        rpc: availSpec.rpc,
        types: availSpec.types,
        signedExtensions: availSpec.signedExtensions,
        noInitWarn: true
      });
    } else if (_API_OPTIONS_CHAIN_GROUP.goldberg.includes(this.chainSlug)) {
      api = new ApiPromise({
        provider,
        rpc: goldbergRpc,
        types: goldbergTypes,
        signedExtensions: availSpec.signedExtensions,
        noInitWarn: true
      });
    } else {
      api = new ApiPromise(apiOption);
    }

    const dedot = new Dedot({
      provider: new ProviderInterfaceAdapter(provider),
      throwOnUnknownApi: false,
      runtimeApis: RuntimeApis,
      signedExtensions: { CheckAppId },
      cacheMetadata: true
    });
    dedot.connect().catch(console.error);

    this.#awaitReady();

    api.on('ready', this.#setApiReady);
    dedot.on('ready', this.#setDedotReady);
    api.on('connected', this.onConnect.bind(this));
    api.on('disconnected', this.onDisconnect.bind(this));
    api.on('error', this.onError.bind(this));
    dedot.on('error', () => this.onError.bind(this));

    return [api, dedot];
  }

  #apiReady = false;
  #dedotReady = false;

  #setApiReady = () => {
    this.#apiReady = true;
  }

  #setDedotReady = () => {
    this.#dedotReady = true;
  }

  #readyTimer?: ReturnType<typeof setInterval>;
  #awaitReady = () => {
    this.#readyTimer && clearInterval(this.#readyTimer);
    this.#readyTimer = setInterval(() => {
      if (this.#apiReady && this.#dedotReady) {
        this.onReady();

        clearInterval(this.#readyTimer);
      }
    })
  }

  constructor (chainSlug: string, apiUrl: string, { externalApiPromise, metadata, providerName }: _ApiOptions = {}) {
    this.chainSlug = chainSlug;
    this.apiUrl = apiUrl;
    this.providerName = providerName;
    this.registry = new TypeRegistry();
    this.metadata = metadata;
    this.handleApiReady = createPromiseHandler<_SubstrateApi>();

    this.provider = this.createProvider(apiUrl);
    [this.api, this.dedot] = this.createApi(this.provider, externalApiPromise);
  }

  get isReady (): Promise<_SubstrateApi> {
    return this.handleApiReady.promise;
  }

  async updateApiUrl (apiUrl: string) {
    if (this.apiUrl === apiUrl) {
      return;
    }

    console.log('Update URL', apiUrl, this.apiUrl);

    // Disconnect with old provider
    await this.disconnect();

    this.isApiReadyOnce = false;
    this.#apiReady = false;
    this.#dedotReady = false;
    clearInterval(this.#readyTimer);
    this.#readyTimer = undefined;

    this.api.off('ready', this.#setApiReady);
    this.api.off('connected', this.onConnect.bind(this));
    this.api.off('disconnected', this.onDisconnect.bind(this));
    this.api.off('error', this.onError.bind(this));

    this.dedot.off('ready', this.#setDedotReady);
    this.dedot.off('error', this.onError.bind(this));

    // Create new provider and api
    this.apiUrl = apiUrl;
    this.provider = this.createProvider(apiUrl);
    [this.api, this.dedot] = this.createApi(this.provider);
  }

  connect (): void {
    if (this.api.isConnected) {
      this.updateConnectionStatus(_ChainConnectionStatus.CONNECTED);
    } else {
      this.updateConnectionStatus(_ChainConnectionStatus.CONNECTING);

      Promise.all([this.api.connect(), this.dedot.connect()])
        .then(() => {
          this.api.isReady.then(() => {
            this.updateConnectionStatus(_ChainConnectionStatus.CONNECTED);
          }).catch(console.error);
        }).catch(console.error);
    }
  }

  async disconnect () {
    try {
      await this.api.disconnect();
      await this.dedot.disconnect();
    } catch (e) {
      console.error(e);
    }

    this.updateConnectionStatus(_ChainConnectionStatus.DISCONNECTED);
  }

  async recoverConnect () {
    await this.disconnect();
    this.connect();
    await this.handleApiReady.promise;
  }

  destroy () {
    // Todo: implement this in the future
    return this.disconnect();
  }

  onReady (): void {
    console.log('on ready!');
    this.fillApiInfo().then(() => {
      this.handleApiReady.resolve(this);
      this.isApiReady = true;
      this.isApiReadyOnce = true;
    }).catch((error) => {
      this.apiError = (error as Error)?.message;
      this.handleApiReady.reject(error);
    });
  }

  onConnect (): void {
    this.updateConnectionStatus(_ChainConnectionStatus.CONNECTED);
    this.substrateRetry = 0;
    console.log(`Connected to ${this.chainSlug || ''} at ${this.apiUrl}`);

    if (this.isApiReadyOnce) {
      this.handleApiReady.resolve(this);
    }
  }

  onDisconnect (): void {
    this.isApiReady = false;
    console.log(`Disconnected from ${this.chainSlug} at ${this.apiUrl}`);
    this.updateConnectionStatus(_ChainConnectionStatus.DISCONNECTED);
    this.handleApiReady = createPromiseHandler<_SubstrateApi>();
    this.substrateRetry += 1;

    if (this.substrateRetry > 9) {
      this.disconnect().then(() => {
        this.updateConnectionStatus(_ChainConnectionStatus.UNSTABLE);
      }).catch(console.error);
    }
  }

  onError (e: Error): void {
    console.warn(`${this.chainSlug} connection got error`, e);
  }

  async fillApiInfo (): Promise<void> {
    const { api, dedot, registry } = this;
    console.log('dedot connection status', dedot.status);

    this.specName = dedot.runtimeVersion.specName.toString();
    this.specVersion = dedot.runtimeVersion.specVersion.toString();

    [this.systemChain, this.systemName, this.systemVersion] = await Promise.all([
      dedot.rpc.system_chain(),
      dedot.rpc.system_name(),
      dedot.rpc.system_version()
    ]);

    const DEFAULT_DECIMALS = 12;
    const properties = await dedot.rpc.system_properties();
    const ss58Format = dedot.consts.system.ss58Prefix;
    const tokenSymbol = properties.tokenSymbol ? [properties.tokenSymbol].flat() : [formatBalance.getDefaults().unit, ...DEFAULT_AUX];
    const tokenDecimals = properties.tokenDecimals ? [properties.tokenDecimals].flat() : [DEFAULT_DECIMALS];

    registry.setChainProperties(registry.createType('ChainProperties', { ss58Format, tokenDecimals, tokenSymbol }));

    // first set up the UI helpers
    this.defaultFormatBalance = {
      decimals: tokenDecimals,
      unit: tokenSymbol[0]
    };

    const defaultSection = Object.keys(api.tx)[0];
    const defaultMethod = Object.keys(api.tx[defaultSection])[0];

    this.apiDefaultTx = api.tx[defaultSection][defaultMethod];
    this.apiDefaultTxSudo = (api.tx.system && api.tx.system.setCode) || this.apiDefaultTx;
  }
}
