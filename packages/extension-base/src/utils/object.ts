// Copyright 2019-2022 @subwallet/extension-koni authors & contributors
// SPDX-License-Identifier: Apache-2.0


import { BN } from "@polkadot/util";
import { AccountId32 } from "@dedot/codecs";

export function isEmptyObject (input: Record<any, any>): boolean {
  return Object.keys(input).length === 0;
}

export function convertToPrimitives (input: any): any {
  if (input && typeof input['toPrimitive'] === 'function') {
    return input['toPrimitive']();
  }

  if (input instanceof AccountId32) {
    return input.address();
  }

  if (Array.isArray(input)) {
    return input.map(convertToPrimitives);
  }

  return input;
}

export function convertToBn(input: any): BN | undefined {
  if (!input) return;

  if (typeof input === 'bigint') {
    return new BN(input.toString());
  }

  return new BN(input)
}

export function convertToHuman(input: any): any {
  if (input && typeof input['toHuman'] === 'function') {
    return input['toHuman']();
  }

  return input;
}
