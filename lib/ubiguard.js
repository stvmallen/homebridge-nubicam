let request = require('request');
const BASE_URL = "https://api.ubiguard.com:3003/{endpoint}?domain=nubicam.ubiguard.com";

class User {
    constructor(username, password) {
        this.username = username;
        this.password = password;
    };

    login() {
        return new Promise((resolve, reject) => {
            let user = this;

            request.post(BASE_URL.replace("{endpoint}", "/client/user/auth"), (error, response, body) => {
                if (response.statusCode === 200) {
                    user.userId = JSON.parse(body).id;
                    resolve();
                } else {
                    let reason = {
                        message: "Error logging in",
                        error: response.statusMessage
                    };

                    reject(reason);
                }
            }).auth(this.username, this.password);
        })
    };

    getCameras() {
        return new Promise(((resolve, reject) => {
            request.get(BASE_URL.replace("{endpoint}", "/client/user/{userId}/cameras".replace("{userId}", this.userId)),
                (error, response, body) => {
                    if (response.statusCode === 200) {
                        resolve(JSON.parse(body));
                    } else {
                        let reason = {
                            message: "Error getting cameras",
                            error: response.statusMessage
                        };

                        reject(reason);
                    }
                }).auth(this.username, this.password);
        }));
    };
}

class Camera {
    constructor(user, camera) {
        this.user = user;
        this.cameraId = camera.cameraid;
        this.name = camera.friendlyname;
        this.model = camera.modelid;
    }

    getCameraFeed() {
        return new Promise(((resolve, reject) => {
            request.get(BASE_URL.replace("{endpoint}", "/client/camera/{cameraId}/live".replace("{cameraId}", this.cameraId)),
                {
                    headers: {
                        "User-Agent": ""
                    }
                },
                (error, response, body) => {
                    if (response.statusCode === 200) {
                        resolve(JSON.parse(body));
                    } else {
                        let reason = {
                            message: "Error getting camera feed for " + this.name,
                            error: response.statusMessage
                        };

                        reject(reason);
                    }
                }).auth(this.user.username, this.user.password);
        }));
    }
}

module.exports = {
    User,
    Camera
};
