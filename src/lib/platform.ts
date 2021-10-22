import {API, APIEvent, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, CameraControllerOptions,} from "homebridge";

import {Ubiguard as NubicamUser} from "./ubiguard"
import {NubicamCamera} from "./ubiguard"
import {FfmpegStreamingDelegate} from "./ffmpegStreamingDelegate";

const PLUGIN_NAME = "homebridge-nubicam";
export const PLATFORM_NAME = "Nubicam";

export class NubicamPlatform implements DynamicPlatformPlugin {
    private log: Logging;
    private api: API;

    private nubicamUsername: string;
    private nubicamPassword: string;
    private ignoreCameraIds: string[];

    private nubicamUser: NubicamUser;

    private readonly accessories: PlatformAccessory[] = [];

    constructor(log: Logging, config: PlatformConfig, api: API) {
        this.log = log;
        this.api = api;

        this.nubicamUsername = config.username;
        this.nubicamPassword = config.password;
        this.ignoreCameraIds = config.ignoredCameraIds;

        this.log("Ignored cameras: ", this.ignoreCameraIds)

        this.nubicamUser = new NubicamUser(config.username, config.password);

        api.on(APIEvent.DID_FINISH_LAUNCHING, this.discoverNewCameras.bind(this));
    }

    configureAccessory(accessory: PlatformAccessory): void {
        this.log("Configuring camera %s", accessory.displayName);

        let camera: NubicamCamera = accessory.context.nubicamCamera;

        accessory
            .getService(this.api.hap.Service.AccessoryInformation)!
            .setCharacteristic(this.api.hap.Characteristic.Name, camera.friendlyname)
            .setCharacteristic(this.api.hap.Characteristic.Manufacturer, "Nubicam")
            .setCharacteristic(this.api.hap.Characteristic.Model, camera.modelid)
            .setCharacteristic(this.api.hap.Characteristic.SerialNumber, camera.cameraid);

        const streamingDelegate = new FfmpegStreamingDelegate(this.api.hap, () => this.nubicamUser.getCameraFeed(camera.cameraid), this.log);
        const options: CameraControllerOptions = {
            cameraStreamCount: 3,
            delegate: streamingDelegate,

            streamingOptions: {
                proxy: undefined,
                supportedCryptoSuites: [this.api.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
                video: {
                    codec: {
                        profiles: [this.api.hap.H264Profile.BASELINE, this.api.hap.H264Profile.MAIN, this.api.hap.H264Profile.HIGH],
                        levels: [this.api.hap.H264Level.LEVEL3_1, this.api.hap.H264Level.LEVEL3_2, this.api.hap.H264Level.LEVEL4_0],
                    },
                    resolutions: [
                        //[width, height, framerate]
                        [1920, 1080, 12],
                        [1280, 960, 12],
                        [1280, 720, 12],
                        [1024, 768, 12],
                        [640, 480, 12],
                        [640, 360, 12],
                        [480, 360, 12],
                        [480, 270, 12],
                        [320, 240, 12],
                        [320, 240, 12],
                        [320, 180, 12],
                    ],
                },
                audio: {
                    comfort_noise: false,
                    codecs: [
                        {
                            type: this.api.hap.AudioStreamingCodecType.OPUS,
                            audioChannels: 1,
                            samplerate: [this.api.hap.AudioStreamingSamplerate.KHZ_16, this.api.hap.AudioStreamingSamplerate.KHZ_24],
                        },
                    ],
                },
            }
        }

        const cameraController = new this.api.hap.CameraController(options);
        streamingDelegate.controller = cameraController;

        accessory.configureController(cameraController);

        this.accessories.push(accessory);
    }

    private discoverNewCameras(): void {
        this.nubicamUser.login()
            .then(() => this.nubicamUser.getCameras())
            .then(cameras => {
                cameras.forEach(this.configureNewCamera.bind(this))
            })
    }

    private configureNewCamera(camera: NubicamCamera): void {
        if (this.ignoreCameraIds.includes(camera.cameraid)) {
            this.log("Skipping camera ", camera.cameraid)
            return
        }

        this.log.debug("NubicamCamera=", camera);

        const uuid = this.api.hap.uuid.generate(camera.cameraid);

        if (!this.accessories.find(accessory => accessory.UUID === uuid)) {
            this.log("Discovered new camera %s", camera.friendlyname);

            const accessory = new this.api.platformAccessory(camera.friendlyname, uuid);

            accessory.context.nubicamCamera = camera;

            this.configureAccessory(accessory);

            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
    }
}
