// Copyright 2019-2022 @subwallet/extension-base authors & contributors
// SPDX-License-Identifier: Apache-2.0

import '@polkadot/types-augment';

import { options as acalaOptions } from '@acala-network/api';
import { rpc as oakRpc, types as oakTypes } from '@oak-foundation/types';
import { MetadataItem } from '@subwallet/extension-base/background/KoniTypes';
import {
  _API_OPTIONS_CHAIN_GROUP,
  API_AUTO_CONNECT_MS,
  API_CONNECT_TIMEOUT
} from '@subwallet/extension-base/services/chain-service/constants';
import { getSubstrateConnectProvider } from '@subwallet/extension-base/services/chain-service/handler/light-client';
import { DEFAULT_AUX } from '@subwallet/extension-base/services/chain-service/handler/SubstrateChainHandler';
import { _ApiOptions } from '@subwallet/extension-base/services/chain-service/handler/types';
import {
  _ChainConnectionStatus,
  _SubstrateApi,
  _SubstrateDefaultFormatBalance
} from '@subwallet/extension-base/services/chain-service/types';
import { createPromiseHandler, PromiseHandler } from '@subwallet/extension-base/utils/promise';
import { BehaviorSubject } from 'rxjs';

import { ApiPromise, WsProvider } from '@polkadot/api';
import { SubmittableExtrinsicFunction } from '@polkadot/api/promise/types';
import { ApiOptions } from '@polkadot/api/types';
import { typesBundle } from '@polkadot/apps-config/api';
import { ProviderInterface } from '@polkadot/rpc-provider/types';
import { TypeRegistry } from '@polkadot/types/create';
import { Registry } from '@polkadot/types/types';
import { BN, formatBalance, isFunction, u8aToHex } from '@polkadot/util';
import { defaults as addressDefaults } from '@polkadot/util-crypto/address/defaults';
import { Dedot, PortableRegistry, SignedExtension, $, PalletTxMetadataLatest } from "dedot";
import { $Metadata } from "@dedot/codecs";
import { RuntimeApis } from "@dedot/specs";
import { EventEmitter } from "@dedot/utils";
import {
  ConnectionStatus,
  JsonRpcProvider,
  ProviderEvent,
  Subscription,
  SubscriptionCallback,
  SubscriptionInput
} from "@dedot/providers";

const overrideBigIntEncode = (shape: $.AnyShape) => {
  const originSubEncode = shape.subEncode;

  shape.subEncode = (buffer, value: any) => {
    let nextValue = value;
    if (typeof value === 'string' || value instanceof BN) {
      nextValue = BigInt(value.toString());
    }

    console.log('before encode', value, nextValue);

    return originSubEncode(buffer, nextValue as never);
  };
}

overrideBigIntEncode($.u64);
overrideBigIntEncode($.u128);
overrideBigIntEncode($.u256);

overrideBigIntEncode($.compact($.u64));
overrideBigIntEncode($.compact($.u128));
overrideBigIntEncode($.compact($.u256));

console.log('DONE SHAPES OVERRIDE');


class CheckAppId extends SignedExtension<number> {
  override async init(): Promise<void> {
    this.data = this.payloadOptions.appId || 0;
  }
}

class ProviderInterfaceAdapter extends EventEmitter<ProviderEvent> implements JsonRpcProvider {
  constructor(public inner: ProviderInterface) {
    super();

    this.inner.on('connected', () => this.#emit('connected'));
    this.inner.on('disconnected', () => this.#emit('disconnected'));
    this.inner.on('error', () => this.#emit('error'));

    if (this.inner.isConnected) {
      this.emit('connected');
    }
  }

  #emit(event: ProviderEvent) {
    console.log('ProviderEvent', event);
    this.emit(event);
  }

  get status(): ConnectionStatus {
    if (this.inner.isConnected) {
      return 'connected';
    } else {
      return 'disconnected';
    }
  }

  async connect(): Promise<this> {
    try {
      await this.inner.connect();
    } catch (e) {
      console.error(e);
    }

    return this
  }

  disconnect(): Promise<void> {
    return this.inner.disconnect();
  }

  send<T = any>(method: string, params: any[]): Promise<T> {
    return this.inner.send(method, params);
  }

  async subscribe<T = any>(input: SubscriptionInput, callback: SubscriptionCallback<T>): Promise<Subscription> {
    let sub: Subscription;

    const subscriptionId = await this.inner.subscribe(input.subname, input.subscribe, input.params, (error, result) => {
      callback(error, result, sub);
    });

    sub = {
      unsubscribe: async () => {
        await this.inner.unsubscribe(input.subname, input.unsubscribe, subscriptionId);
      },
      subscriptionId: subscriptionId.toString()
    }

    return sub;
  }
}

export interface Carrier {
  exec: (...args: any[]) => any;
  chain?: string[];
}

export const newProxyChain = (
  carrier: Carrier,
  currentLevel = 1,
  maxLevel = 3,
) => {
  const { exec, chain = [] } = carrier;
  if (currentLevel === maxLevel) {
    return exec(...chain);
  }

  return new Proxy(carrier, {
    get(target: Carrier, property: string | symbol, receiver: any): any {
      if (!target.chain) {
        target.chain = [];
      }

      const { chain } = target;

      chain.push(property.toString());

      return newProxyChain(target, currentLevel + 1, maxLevel);
    },
  });
};

export class DedotProxy extends EventEmitter {
  dedot!: Dedot;

  public get isDedot() {
    return true;
  }

  constructor(provider: ProviderInterface) {
    super();

    this.dedot = new Dedot({
      provider: new ProviderInterfaceAdapter(provider),
      throwOnUnknownApi: false,
      runtimeApis: RuntimeApis,
      signedExtensions: { CheckAppId }
    });

    this.dedot.on('connected', () => this.emit('connected'));
    this.dedot.on('disconnected', () => this.emit('disconnected'));
    this.dedot.on('ready', () => this.emit('ready'));
    this.dedot.on('error', () => this.emit('error'));
  }

  get rpc() {
    return newProxyChain({ exec: (...chain: string[]) => this.dedot.rpc[chain.join('_')] });
  }

  get tx() {
    return newProxyChain({
      exec: (pallet: string, method: string) => {
        const txMeta = this.dedot.tx[pallet][method].meta as PalletTxMetadataLatest;

        console.log(pallet, method);

        const fn = (...args: any[]) => {
          if (pallet === 'utility' && (method === 'batch' || method === 'batchAll')) {
            // @ts-ignore
            args[0] = args[0].map((arg) => arg.call);
          }

          txMeta.fieldCodecs.forEach(($codec, index) => {
            if ($codec.metadata[0].factory === $.taggedUnion) {
              args[index] = $codec.tryDecode(args[index]);
              console.log('field', $codec);
            }
          });

          console.log('args', args);

          // @ts-ignore
          return this.dedot.tx[pallet][method](...args);
        }

        fn.meta = txMeta;

        return fn;
      }
    })
  }

  get query() {
    return newProxyChain({
      exec: (pallet: string, method: string) => {
        const query = this.dedot.query[pallet][method];

        const fn = (...args: any[]) => {
          let inArgs = args.slice();
          const lastArg = args.at(-1);
          const callback = isFunction(lastArg) ? inArgs.pop() : undefined;
          if (inArgs.length === 1) {
            inArgs = inArgs[0];
          }

          return query(inArgs, callback);
        };

        Object.assign(fn, query);

        return fn;
      }
    })
  }

  get call() {
    return this.dedot.call;
  }

  get consts() {
    return this.dedot.consts;
  }

  async connect() {
    await this.dedot.connect();
  }

  async disconnect() {
    await this.dedot.disconnect();
  }

  get isConnected() {
    return this.dedot?.status === 'connected';
  }

  get isReady(): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (this.isConnected) {
          clearInterval(timer);
          resolve(true);
        }
      })
    });
  }

  get runtimeVersion() {
    return this.dedot.runtimeVersion;
  }

  get genesisHash() {
    return {
      toHex: () => this.dedot.genesisHash
    };
  }

  get runtimeMetadata() {
    return {
      toHex: () => u8aToHex($Metadata.tryEncode(this.dedot.metadata)),
      toJSON: () => JSON.parse(JSON.stringify(this.dedot.metadata))
    }
  }

  get registry(): PortableRegistry {
    const props = this.dedot.chainProperties!;
    const registry = this.dedot.registry;
    Object.assign(registry, {
      chainSS58: props.ss58Format,
      tokenDecimals: props.tokenDecimals,
      tokenSymbol: props.tokenSymbol || ['UNIT']
    });

    return registry
  }

  get runtimeChain() {
    return this.dedot.runtimeChain;
  }
}

export class SubstrateApi implements _SubstrateApi {
  chainSlug: string;
  api: ApiPromise;
  providerName?: string;
  provider: ProviderInterface;
  apiUrl: string;
  metadata?: MetadataItem;

  useLightClient = false;
  isApiReady = false;
  isApiReadyOnce = false;
  apiError?: string;
  private handleApiReady: PromiseHandler<_SubstrateApi>;
  public readonly isApiConnectedSubject = new BehaviorSubject(false);
  public readonly connectionStatusSubject = new BehaviorSubject(_ChainConnectionStatus.DISCONNECTED);

  get isApiConnected(): boolean {
    return this.isApiConnectedSubject.getValue();
  }

  substrateRetry = 0;

  get connectionStatus(): _ChainConnectionStatus {
    return this.connectionStatusSubject.getValue();
  }

  private updateConnectionStatus(status: _ChainConnectionStatus): void {
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

  private createProvider(apiUrl: string): ProviderInterface {
    if (apiUrl.startsWith('light://')) {
      this.useLightClient = true;

      return getSubstrateConnectProvider(apiUrl.replace('light://substrate-connect/', ''));
    } else {
      this.useLightClient = true;

      return new WsProvider(apiUrl, API_AUTO_CONNECT_MS, {}, API_CONNECT_TIMEOUT);
    }
  }

  private createApi(provider: ProviderInterface, externalApiPromise?: ApiPromise): ApiPromise {
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
      api = new ApiPromise(acalaOptions({provider, noInitWarn: true}));
    } else if (_API_OPTIONS_CHAIN_GROUP.turing.includes(this.chainSlug)) {
      api = new ApiPromise({
        provider,
        rpc: oakRpc,
        types: oakTypes,
        noInitWarn: true
      });
    } else if (_API_OPTIONS_CHAIN_GROUP.avail.includes(this.chainSlug)) {
      api = new DedotProxy(provider) as unknown as ApiPromise;
    } else if (_API_OPTIONS_CHAIN_GROUP.goldberg.includes(this.chainSlug)) {
      api = new DedotProxy(provider) as unknown as ApiPromise;
    } else {
      api = new ApiPromise(apiOption);
    }

    api.on('ready', this.onReady.bind(this));
    api.on('connected', this.onConnect.bind(this));
    api.on('disconnected', this.onDisconnect.bind(this));
    api.on('error', this.onError.bind(this));

    return api;
  }

  constructor (chainSlug: string, apiUrl: string, { externalApiPromise, metadata, providerName }: _ApiOptions = {}) {
    this.chainSlug = chainSlug;
    this.apiUrl = apiUrl;
    this.providerName = providerName;
    this.registry = new TypeRegistry();
    this.metadata = metadata;
    this.provider = this.createProvider(apiUrl);
    this.api = this.createApi(this.provider, externalApiPromise);

    this.handleApiReady = createPromiseHandler<_SubstrateApi>();
  }

  get isReady (): Promise<_SubstrateApi> {
    return this.handleApiReady.promise;
  }

  async updateApiUrl (apiUrl: string) {
    if (this.apiUrl === apiUrl) {
      return;
    }

    // Disconnect with old provider
    await this.disconnect();
    this.isApiReadyOnce = false;
    this.api.off('ready', this.onReady.bind(this));
    this.api.off('connected', this.onConnect.bind(this));
    this.api.off('disconnected', this.onDisconnect.bind(this));
    this.api.off('error', this.onError.bind(this));

    // Create new provider and api
    this.apiUrl = apiUrl;
    this.provider = this.createProvider(apiUrl);
    this.api = this.createApi(this.provider);
  }

  connect (): void {
    if (this.api.isConnected) {
      this.updateConnectionStatus(_ChainConnectionStatus.CONNECTED);
    } else {
      this.updateConnectionStatus(_ChainConnectionStatus.CONNECTING);

      this.api.connect()
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
    const { api, registry } = this;
    const DEFAULT_DECIMALS = registry.createType('u32', 12);
    const DEFAULT_SS58 = registry.createType('u32', addressDefaults.prefix);

    this.specName = this.api.runtimeVersion.specName.toString();
    this.specVersion = this.api.runtimeVersion.specVersion.toString();

    const [systemChain, systemName, systemVersion] = await Promise.all([
      api.rpc.system?.chain(),
      api.rpc.system?.name(),
      api.rpc.system?.version()
    ]);

    this.systemChain = systemChain.toString();
    this.systemName = systemName.toString();
    this.systemVersion = systemVersion.toString();

    const properties = registry.createType('ChainProperties', {
      ss58Format: api.registry.chainSS58,
      tokenDecimals: api.registry.chainDecimals,
      tokenSymbol: api.registry.chainTokens
    });
    const ss58Format = properties.ss58Format.unwrapOr(DEFAULT_SS58).toNumber();
    const tokenSymbol = properties.tokenSymbol.unwrapOr([formatBalance.getDefaults().unit, ...DEFAULT_AUX]);
    const tokenDecimals = properties.tokenDecimals.unwrapOr([DEFAULT_DECIMALS]);

    registry.setChainProperties(registry.createType('ChainProperties', {ss58Format, tokenDecimals, tokenSymbol}));

    // first set up the UI helpers
    this.defaultFormatBalance = {
      decimals: tokenDecimals.map((b: BN) => {
        return b.toNumber();
      }),
      unit: tokenSymbol[0].toString()
    };

    // const defaultSection = Object.keys(api.tx)[0];
    // const defaultMethod = Object.keys(api.tx[defaultSection])[0];
    //
    // this.apiDefaultTx = api.tx[defaultSection][defaultMethod];
    this.apiDefaultTxSudo = (api.tx.system && api.tx.system.setCode);
  }
}
