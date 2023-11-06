// Copyright 2019-2022 @subwallet/extension-koni-ui authors & contributors
// SPDX-License-Identifier: Apache-2.0

import { _ChainAsset } from '@subwallet/chain-list/types';
import { BalanceItem } from '@subwallet/extension-base/types';
import { Avatar } from '@subwallet/extension-koni-ui/components';
import { useGetAccountByAddress, useSelector, useTranslation } from '@subwallet/extension-koni-ui/hooks';
import { ThemeProps } from '@subwallet/extension-koni-ui/types';
import { toShort } from '@subwallet/extension-koni-ui/utils';
import BigN from 'bignumber.js';
import CN from 'classnames';
import React, { useMemo } from 'react';
import styled from 'styled-components';

import { MetaInfo } from '../MetaInfo';

interface Props extends ThemeProps {
  item: BalanceItem;
}

const Component: React.FC<Props> = (props: Props) => {
  const { className, item } = props;

  const { address, free, locked, tokenSlug } = item;

  const { t } = useTranslation();
  const { assetRegistry } = useSelector((state) => state.assetRegistry);

  const account = useGetAccountByAddress(address);

  const tokenInfo = useMemo((): _ChainAsset|undefined => assetRegistry[tokenSlug], [assetRegistry, tokenSlug]);
  const total = useMemo(() => new BigN(free).plus(locked).toString(), [free, locked]);

  const name = useMemo(() => {
    return account?.name;
  }, [account?.name]);

  const decimals = tokenInfo?.decimals || 0;
  const symbol = tokenInfo?.symbol || '';

  return (
    <MetaInfo
      className={CN(className, 'account-token-detail')}
      hasBackgroundWrapper={true}
      spaceSize='xxs'
    >
      <MetaInfo.Number
        className='account-info'
        decimals={decimals}
        label={(
          <div className='account-info'>
            <Avatar
              size={24}
              value={address}
            />
            <div className='account-name-address ml-xs'>
              {
                name
                  ? (
                    <>
                      <span className='account-name'>{name}</span>
                      <span className='account-address'>&nbsp;({toShort(address, 4, 4)})</span>
                    </>
                  )
                  : (
                    <span className='account-name'>({toShort(address)})</span>
                  )
              }
            </div>
          </div>
        )}
        suffix={symbol}
        value={total}
        valueColorSchema='light'
      />
      <MetaInfo.Number
        className='balance-info'
        decimals={decimals}
        label={t('Transferable')}
        suffix={symbol}
        value={free}
        valueColorSchema='gray'
      />
      <MetaInfo.Number
        className='balance-info'
        decimals={decimals}
        label={t('Locked')}
        suffix={symbol}
        value={locked}
        valueColorSchema='gray'
      />
    </MetaInfo>
  );
};

const AccountTokenBalanceItem = styled(Component)<Props>(({ theme: { token } }: Props) => {
  return {
    '&.meta-info-block': {
      marginTop: token.marginXS
    },

    '&.account-token-detail': {
      '.__col:first-child': {
        flex: 2
      },

      '.__row': {
        marginBottom: 0
      }
    },

    '.account-info': {
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      fontSize: token.fontSizeHeading6,
      lineHeight: token.lineHeightHeading6,

      '.account-name-address': {
        overflow: 'hidden',
        textWrap: 'nowrap',
        display: 'flex',
        flexDirection: 'row'
      },

      '.account-name': {
        color: token.colorText,
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      },

      '.account-address': {
        color: token.colorTextTertiary
      }
    },

    '.balance-info': {
      '.__label': {
        marginLeft: token.marginXL,
        fontSize: token.fontSizeSM,
        lineHeight: token.lineHeightSM,
        color: token.colorTextTertiary
      },

      '.__value': {
        fontSize: token.fontSizeSM,
        lineHeight: token.lineHeightSM
      }
    }
  };
});

export default AccountTokenBalanceItem;
