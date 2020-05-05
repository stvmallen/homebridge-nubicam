import type { API } from 'homebridge';

import {NubicamPlatform, PLATFORM_NAME} from './lib/platform';

export = (api: API) => {
    api.registerPlatform(PLATFORM_NAME, NubicamPlatform);
}
