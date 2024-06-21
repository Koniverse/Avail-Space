// Copyright 2019-2022 @subwallet/extension-base
// SPDX-License-Identifier: Apache-2.0

import { _ChainAsset, _ChainInfo } from '@subwallet/chain-list/types';
import { getWeb3Contract } from '@subwallet/extension-base/koni/api/contract-handler/evm/web3';
import { _SNOWBRIDGE_GATEWAY_ABI, SNOWBRIDGE_GATEWAY_CONTRACT_ADDRESS } from '@subwallet/extension-base/koni/api/contract-handler/utils';
import { _EvmApi } from '@subwallet/extension-base/services/chain-service/types';
import { _getContractAddressOfToken, _getSubstrateParaId, _isChainEvmCompatible } from '@subwallet/extension-base/services/chain-service/utils';
import { calculateGasFeeParams } from '@subwallet/extension-base/services/fee-service/utils';
import { TransactionConfig } from 'web3-core';

import { u8aToHex } from '@polkadot/util';
import { decodeAddress } from '@polkadot/util-crypto';

export async function getSnowBridgeEvmTransfer (tokenInfo: _ChainAsset, originChainInfo: _ChainInfo, destinationChainInfo: _ChainInfo, sender: string, recipientAddress: string, value: string, evmApi: _EvmApi): Promise<TransactionConfig> {
  const snowBridgeContract = getWeb3Contract(SNOWBRIDGE_GATEWAY_CONTRACT_ADDRESS, evmApi, _SNOWBRIDGE_GATEWAY_ABI);
  const tokenContract = _getContractAddressOfToken(tokenInfo);
  const destinationChainParaId = _getSubstrateParaId(destinationChainInfo);
  const recipient = {
    kind: 1,
    data: _isChainEvmCompatible(destinationChainInfo) ? recipientAddress : u8aToHex(decodeAddress(recipientAddress))
  };
  const destinationFee = '0';

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment
  const transferCall = snowBridgeContract.methods.sendToken(tokenContract, destinationChainParaId, recipient, destinationFee, value);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment
  const transferEncodedCall = transferCall.encodeABI() as string;
  const priority = await calculateGasFeeParams(evmApi, evmApi.chainSlug);

  let gasLimit;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
    gasLimit = await transferCall.estimateGas({ from: sender }) as number;
  } catch (e) {
    gasLimit = 200000; // todo: handle this better
  }

  return {
    from: sender,
    to: SNOWBRIDGE_GATEWAY_CONTRACT_ADDRESS,
    data: transferEncodedCall,
    gas: gasLimit,
    gasPrice: priority.gasPrice,
    maxFeePerGas: priority.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: priority.maxPriorityFeePerGas?.toString()
  } as TransactionConfig;
}
