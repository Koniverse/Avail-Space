// Copyright 2019-2022 @subwallet/extension-base
// SPDX-License-Identifier: Apache-2.0

import { TransactionConfig } from 'web3-core';

import { SubmittableExtrinsic } from '@polkadot/api/types';
import { DedotExtrinsic } from "@subwallet/extension-base/services/transaction-service/types";

export type TransactionData = SubmittableExtrinsic<'promise'> | TransactionConfig | DedotExtrinsic;
