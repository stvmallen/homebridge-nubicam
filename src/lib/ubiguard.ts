import * as request from "request-promise-native";
import {RequestPromiseOptions} from "request-promise-native";

const BASE_URL = "https://api.ubiguard.com:3003/{endpoint}?domain=nubicam.ubiguard.com";

export type NubicamCamera = {
    cameraid: string,
    friendlyname: string,
    modelid: string
}

export class Ubiguard {
    private username: string;
    private password: string;
    private userId: string;

    constructor(username: string, password: string) {
        this.username = username;
        this.password = password;
        this.userId = "";
    };

    async login(): Promise<string> {
        let options = {
            url: BASE_URL.replace("{endpoint}", "client/user/auth"),
            auth: {
                username: this.username,
                password: this.password
            },
            json: true
        };

        this.userId = await request.post(options)
            .then(user => user.id);

        return this.userId;
    };

    async getCameras(): Promise<NubicamCamera[]> {
        let options = {
            url: BASE_URL.replace("{endpoint}", "client/user/{userId}/cameras".replace("{userId}", this.userId)),
            auth: {
                username: this.username,
                password: this.password
            },
            json: true
        };

        return request.get(options);
    };

    async getCameraFeed(cameraId: string) {
        let options = {
            url: BASE_URL.replace("{endpoint}", "client/camera/{cameraId}/live".replace("{cameraId}", cameraId)),
            auth: {
                username: this.username,
                password: this.password
            },
            headers: {
                "User-Agent": "Homebridge"
            },
            json: true
        };

        return request.get(options);
    }
}
