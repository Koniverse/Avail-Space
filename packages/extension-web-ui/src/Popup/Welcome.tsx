// Copyright 2019-2022 @polkadot/extension-ui authors & contributors
// SPDX-License-Identifier: Apache-2.0

import { Layout } from '@subwallet/extension-web-ui/components';
import { AutoConnect, CONFIRM_GENERAL_TERM, CONNECT_EXTENSION, CREATE_RETURN, DEFAULT_ACCOUNT_TYPES, DEFAULT_ROUTER_PATH, PREDEFINED_WALLETS, SELECTED_ACCOUNT_TYPE } from '@subwallet/extension-web-ui/constants';
import { ATTACH_ACCOUNT_MODAL, CREATE_ACCOUNT_MODAL, GENERAL_TERM_AND_CONDITION_MODAL, SELECT_ACCOUNT_MODAL } from '@subwallet/extension-web-ui/constants/modal';
import { InjectContext } from '@subwallet/extension-web-ui/contexts/InjectContext';
import useTranslation from '@subwallet/extension-web-ui/hooks/common/useTranslation';
import { WelcomeWatchOnlyAccountForm } from '@subwallet/extension-web-ui/Popup/WelcomeWatchOnlyAccountForm';
import { RootState } from '@subwallet/extension-web-ui/stores';
import { ThemeProps } from '@subwallet/extension-web-ui/types';
import { checkHasInjected } from '@subwallet/extension-web-ui/utils/wallet';
import { Button, Icon, Image, ModalContext } from '@subwallet/react-ui';
import CN from 'classnames';
import { Swatches, Wallet } from 'phosphor-react';
import React, { useCallback, useContext, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useLocalStorage } from 'usehooks-ts';

import { GeneralTermModal } from '../components/Modal/TermsAndConditions/GeneralTermModal';
import SocialGroup from '../components/SocialGroup';
import { ScreenContext } from '../contexts/ScreenContext';
import usePreloadView from '../hooks/router/usePreloadView';
import { isMobile, noop } from '../utils';

type Props = ThemeProps;

type GeneralTermModalProps = {
  onOk: VoidFunction;
}

let tryToConnect = false;

function Component ({ className }: Props): React.ReactElement<Props> {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { activeModal, inactiveModal } = useContext(ModalContext);
  const { isWebUI } = useContext(ScreenContext);
  const { enableInject, loadingInject, selectWallet } = useContext(InjectContext);

  const { isNoAccount } = useSelector((root: RootState) => root.accountState);

  const [, setSelectedAccountTypes] = useLocalStorage(SELECTED_ACCOUNT_TYPE, DEFAULT_ACCOUNT_TYPES);
  const [_returnPath, setReturnStorage] = useLocalStorage(CREATE_RETURN, DEFAULT_ROUTER_PATH);
  const [_isConfirmedTermGeneral, setIsConfirmedTermGeneral] = useLocalStorage(CONFIRM_GENERAL_TERM, 'nonConfirmed');
  const [returnPath] = useState(_returnPath);
  const [generalTermModalProps, setGeneralTermModalProps] = useState<GeneralTermModalProps>({
    onOk: noop
  });

  usePreloadView([
    'CreatePassword',
    'CreateDone',
    'NewSeedPhrase'
  ]);

  const markTermAsRead = useCallback(() => {
    setIsConfirmedTermGeneral('confirmed');
  }, [setIsConfirmedTermGeneral]);

  const openModal = useCallback((id: string) => {
    return () => {
      if (id === CONNECT_EXTENSION) {
        selectWallet();
      } else if (id === CREATE_ACCOUNT_MODAL) {
        setSelectedAccountTypes(DEFAULT_ACCOUNT_TYPES);
        navigate('/accounts/new-seed-phrase');
      } else {
        inactiveModal(SELECT_ACCOUNT_MODAL);
        activeModal(id);
      }

      setIsConfirmedTermGeneral('confirmed');
    };
  }
  , [setIsConfirmedTermGeneral, selectWallet, setSelectedAccountTypes, navigate, inactiveModal, activeModal]);

  const termModalHandler = useCallback((action: VoidFunction) => {
    if (_isConfirmedTermGeneral.includes('nonConfirmed')) {
      setGeneralTermModalProps({
        onOk: () => {
          action();
        }
      });
      activeModal(GENERAL_TERM_AND_CONDITION_MODAL);
    } else {
      action();
    }
  }, [_isConfirmedTermGeneral, activeModal]);

  const onClickToSelectTypeConnect = useCallback((idModal: string) => {
    return () => {
      termModalHandler(openModal(idModal));
    };
  }, [openModal, termModalHandler]);

  useEffect(() => {
    if (!isNoAccount) {
      navigate(returnPath, { state: { from: returnPath } });
      setReturnStorage(DEFAULT_ROUTER_PATH);
    }
  }, [isNoAccount, navigate, returnPath, setReturnStorage]);

  useEffect(() => {
    if (isMobile && !tryToConnect && !AutoConnect.ignore) {
      const installedWallet = Object.values(PREDEFINED_WALLETS).find((w) => (w.supportMobile && checkHasInjected(w.key)));

      if (installedWallet) {
        tryToConnect = true;
        enableInject(installedWallet.key);
      }
    }
  }, [enableInject]);

  return (
    <Layout.Base
      className={CN(className, '__welcome-layout-containter')}
    >
      <div className='welcome-bg-image' />
      <div className={'body-container'}>
        <div className={CN('brand-container', 'flex-column')}>
          <div className='logo-container'>
            {
              isWebUI
                ? (
                  <Image
                    src='/images/avail/avail-icon.png'
                    width={120}
                  />
                )
                : (
                  <Image
                    src={'/images/avail/avail-icon.png'}
                    width={90}
                  />
                )
            }
          </div>
          <div className='title'>{t('WELCOME TO AVAIL SPACE')}</div>
          <div className='sub-title'>
            {t('Start exploring blockchain applications in seconds')}
          </div>
        </div>

        <div className='buttons-container'>
          <div className='buttons'>
            <Button
              contentAlign='left'
              icon={
                <Icon
                  phosphorIcon={Swatches}
                  size='md'
                  weight='fill'
                />
              }
              onClick={onClickToSelectTypeConnect(ATTACH_ACCOUNT_MODAL)}
              schema='secondary'
              shape='round'
            >
              {t('Attach an account')}
            </Button>
            <Button
              contentAlign='left'
              icon={
                <Icon
                  phosphorIcon={Wallet}
                  size='md'
                  weight='fill'
                />
              }
              loading={loadingInject}
              onClick={onClickToSelectTypeConnect(CONNECT_EXTENSION)}
              schema='primary'
              shape='round'
            >
              {t('Connect wallet')}
            </Button>
          </div>
          <div className='divider' />
        </div>

        {isWebUI && (
          <WelcomeWatchOnlyAccountForm
            markTermAsRead={markTermAsRead}
            termModalHandler={termModalHandler}
          />
        )}
      </div>

      {isWebUI && (
        <SocialGroup className={'social-group'} />
      )}
      <GeneralTermModal
        {...generalTermModalProps}
      />
    </Layout.Base>
  );
}

const Welcome = styled(Component)<Props>(({ theme: { extendToken, token } }: Props) => {
  return {
    position: 'relative',

    '.ant-sw-screen-layout-body': {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    },

    '.welcome-bg-image': {
      position: 'fixed',
      top: '-10vh',
      left: '0',
      right: '-20vw',
      height: '30vh',
      zIndex: 0,
      transitionDuration: 'background-color 0.3s ease',
      filter: 'blur(110.5px)',
      background: extendToken.tokensScreenInfoBackgroundColor
    },

    '.brand-container': {
      paddingTop: 6
    },

    '.divider': {
      height: 2,
      backgroundColor: token.colorBgDivider,
      opacity: 0.8,
      width: '100%',
      display: 'none'
    },

    '.body-container': {
      padding: `0 ${token.padding}px`,
      textAlign: 'center',

      '.title': {
        marginTop: token.marginXL,
        fontWeight: token.fontWeightStrong,
        fontSize: token.fontSizeHeading1,
        lineHeight: token.lineHeightHeading1,
        color: token.colorTextBase
      },

      '.sub-title': {
        marginTop: token.marginXS,
        marginBottom: token.sizeLG * 2 + token.sizeXS,
        fontSize: token.fontSizeHeading5,
        lineHeight: token.lineHeightHeading5,
        color: token.colorTextLight3
      },

      '.form-title': {
        color: token.colorTextLight3,
        marginBottom: token.margin
      },

      '.add-wallet-container': {
        maxWidth: 384,
        width: '100%',
        marginLeft: 'auto',
        marginRight: 'auto',
        marginBottom: token.margin
      }
    },

    '.__account-name-input .ant-input-label': {
      display: 'flex',
      alignItems: 'center'
    },

    '.buttons-container': {
      '.buttons': {
        fontSize: 16
      },
      '.ant-btn': {
        paddingLeft: token.paddingXL,
        paddingRight: token.paddingXL,
        marginLeft: token.marginSM,
        marginRight: token.marginSM
      }
    },

    '.social-group': {
      marginTop: 0,
      paddingTop: token.paddingLG
    },

    '.web-ui-enable &': {
      textAlign: 'center',
      height: '100%',
      width: '100%',
      maxWidth: 816,
      margin: '0 auto',
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,

      '.ant-sw-screen-layout-body': {
        justifyContent: 'flex-start'
      },

      '.body-container': {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      },

      '.logo-container': {
        height: 120,
        color: token.colorTextBase,
        marginBottom: token.margin,
        marginTop: 24
      },

      '.divider': {
        display: 'block'
      },

      '.title': {
        marginBottom: token.marginXS
      },

      '.sub-title': {
        margin: 0
      },

      '.buttons-container': {
        marginBottom: token.marginXL,
        marginTop: 36,
        width: '100%',

        '.divider': {
          marginTop: 44
        },

        '.buttons': {

        }
      },

      '@media (max-width: 1600px)': {
        '.buttons-container': {
          marginTop: 32,
          marginBottom: 32
        },

        '.add-wallet-container': {
          marginBottom: 0
        },

        '.social-group': {
          paddingBottom: 32
        }
      }
    },
    '@media (max-width: 560px)': {
      '.buttons .ant-btn': {
        display: 'block',
        width: 300,
        marginLeft: 'auto',
        marginRight: 'auto',
        marginBottom: token.margin
      },

      '.body-container .title': {
        fontSize: 24
      },

      '.body-container .sub-title': {
        fontSize: 14
      }
    }
  };
});

export default Welcome;
