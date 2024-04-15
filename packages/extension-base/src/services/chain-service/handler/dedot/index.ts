import { SignedExtension, $, EventEmitter } from "dedot";
import {
  ProviderEvent,
  JsonRpcProvider,
  ConnectionStatus,
  SubscriptionInput,
  SubscriptionCallback,
  Subscription
} from "@dedot/providers";
import { BN } from "@polkadot/util";
import { ProviderInterface } from "@polkadot/rpc-provider/types";

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
