import { SignedExtension } from "dedot";
import {
  ProviderEvent,
  JsonRpcProvider,
  ConnectionStatus,
  SubscriptionInput,
  SubscriptionCallback,
  Subscription
} from "dedot";
import { ProviderInterface } from "@polkadot/rpc-provider/types";
import { EventEmitter } from "dedot/utils";

export class CheckAppId extends SignedExtension<number> {
  override async init(): Promise<void> {
    this.data = this.payloadOptions.appId || 0;
  }
}

export class ProviderInterfaceAdapter extends EventEmitter<ProviderEvent> implements JsonRpcProvider {
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
    } catch {}

    return this
  }

  async disconnect(): Promise<void> {
    await this.inner.disconnect();
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
