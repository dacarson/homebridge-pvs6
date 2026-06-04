import { API } from 'homebridge';
import { PLATFORM_NAME } from './settings';
import { PVS6Platform } from './platform';

export = (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, PVS6Platform);
};
