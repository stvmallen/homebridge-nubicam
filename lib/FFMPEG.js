let uuid, Service, Characteristic, StreamController;

let ip = require('ip');
let spawn = require('child_process').spawn;

const FFMPEG = function (hap, feed, log) {
    this.log = log;
    uuid = hap.uuid;
    Service = hap.Service;
    Characteristic = hap.Characteristic;
    StreamController = hap.StreamController;

    if (!feed.rtsp) {
        throw new Error("Missing source for camera.");
    }

    this.videoSource = feed.rtsp;
    this.snapshotSource = feed.rtsp + "/picture";
    this.services = [];
    this.streamControllers = [];
    this.pendingSessions = {};
    this.ongoingSessions = {};

    let numberOfStreams = 2;

    let options = {
        proxy: false, // Requires RTP/RTCP MUX Proxy
        srtp: true, // Supports SRTP AES_CM_128_HMAC_SHA1_80 encryption
        video: {
            resolutions: [
                //[1920, 1080, 30], // Width, Height, framerate
                //[1280, 960, 30],
                //[1280, 720, 30],
                [1024, 768, 30],
                [640, 480, 30],
                [640, 360, 30],
                [480, 360, 30],
                [480, 270, 30],
                [320, 240, 30],
                [320, 180, 30],
                [320, 240, 15] // Apple Watch requires this configuration
            ],
            codec: {
                profiles: [0, 1, 2], // Enum, please refer StreamController.VideoCodecParamProfileIDTypes
                levels: [0, 1, 2] // Enum, please refer StreamController.VideoCodecParamLevelTypes
            }
        },
        audio: {
            codecs: [
                {
                    type: "OPUS", // Audio Codec
                    samplerate: 24 // 8, 16, 24 KHz
                },
                {
                    type: "AAC-eld",
                    samplerate: 16
                }
            ]
        }
    };

    this.createCameraControlService();
    this._createStreamControllers(numberOfStreams, options);
};

FFMPEG.prototype = {
    handleCloseConnection(connectionID) {
        this.streamControllers.forEach(function (controller) {
            controller.handleCloseConnection(connectionID);
        });
    },

    handleSnapshotRequest(request, callback) {
        let resolution = request.width + 'x' + request.height;
        let imageSource = this.snapshotSource !== undefined ? this.snapshotSource : this.videoSource;
        let ffmpeg = spawn('ffmpeg', (imageSource + ' -t 1 -s ' + resolution + ' -f image2 -').split(' '), {env: process.env});
        let imageBuffer = Buffer(0);
        this.log("Snapshot", imageSource + ' -t 1 -s ' + resolution + ' -f image2 -');
        ffmpeg.stdout.on('data', function (data) {
            imageBuffer = Buffer.concat([imageBuffer, data]);
        });
    },

    prepareStream(request, callback) {
        let sessionInfo = {};

        let sessionID = request["sessionID"];
        sessionInfo["address"] = request["targetAddress"];

        let response = {};

        let videoInfo = request["video"];
        if (videoInfo) {
            let targetPort = videoInfo["port"];
            let srtp_key = videoInfo["srtp_key"];
            let srtp_salt = videoInfo["srtp_salt"];

            response["video"] = {
                port: targetPort,
                ssrc: 1,
                srtp_key: srtp_key,
                srtp_salt: srtp_salt
            };

            sessionInfo["video_port"] = targetPort;
            sessionInfo["video_srtp"] = Buffer.concat([srtp_key, srtp_salt]);
            sessionInfo["video_ssrc"] = 1;
        }

        let audioInfo = request["audio"];
        if (audioInfo) {
            let targetPort = audioInfo["port"];
            let srtp_key = audioInfo["srtp_key"];
            let srtp_salt = audioInfo["srtp_salt"];

            response["audio"] = {
                port: targetPort,
                ssrc: 1,
                srtp_key: srtp_key,
                srtp_salt: srtp_salt
            };

            sessionInfo["audio_port"] = targetPort;
            sessionInfo["audio_srtp"] = Buffer.concat([srtp_key, srtp_salt]);
            sessionInfo["audio_ssrc"] = 1;
        }

        let currentAddress = ip.address();

        let addressResp = {
            address: currentAddress
        };

        if (ip.isV4Format(currentAddress)) {
            addressResp["type"] = "v4";
        } else {
            addressResp["type"] = "v6";
        }

        response["address"] = addressResp;
        this.pendingSessions[uuid.unparse(sessionID)] = sessionInfo;

        callback(response);
    },

    handleStreamRequest(request) {
        let sessionID = request["sessionID"];
        let requestType = request["type"];
        if (sessionID) {
            let sessionIdentifier = uuid.unparse(sessionID);

            if (requestType == "start") {
                let sessionInfo = this.pendingSessions[sessionIdentifier];
                if (sessionInfo) {
                    let width = 1280;
                    let height = 720;
                    let fps = 30;
                    let bitrate = 300;
                    const vcodec = this.vcodec || 'libx264';

                    let videoInfo = request["video"];
                    if (videoInfo) {
                        width = videoInfo["width"];
                        height = videoInfo["height"];

                        let expectedFPS = videoInfo["fps"];
                        if (expectedFPS < fps) {
                            fps = expectedFPS;
                        }

                        bitrate = videoInfo["max_bit_rate"];
                    }

                    let targetAddress = sessionInfo["address"];
                    let targetVideoPort = sessionInfo["video_port"];
                    let videoKey = sessionInfo["video_srtp"];

                    let ffmpegCommand = this.videoSource + ' -threads 0 -vcodec ' + vcodec + ' -an -pix_fmt yuv420p -r ' +
                        fps + ' -f rawvideo -tune zerolatency -vf scale=' + width + ':' + height + ' -b:v ' + bitrate + 'k -bufsize ' +
                        bitrate + 'k -payload_type 99 -ssrc 1 -f rtp -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ' +
                        videoKey.toString('base64') + ' srtp://' + targetAddress + ':' + targetVideoPort + '?rtcpport=' + targetVideoPort +
                        '&localrtcpport=' + targetVideoPort + '&pkt_size=1378';
                    this.log(ffmpegCommand);
                    this.ongoingSessions[sessionIdentifier] = spawn('ffmpeg', ffmpegCommand.split(' '), {env: process.env});
                }

                delete this.pendingSessions[sessionIdentifier];
            } else if (requestType == "stop") {
                let ffmpegProcess = this.ongoingSessions[sessionIdentifier];
                if (ffmpegProcess) {
                    ffmpegProcess.kill('SIGKILL');
                }

                delete this.ongoingSessions[sessionIdentifier];
            }
        }
    },

    createCameraControlService() {
        this.services.push(new Service.CameraControl());
    },

    // Private
    _createStreamControllers(maxStreams, options) {
        let self = this;

        for (let i = 0; i < maxStreams; i++) {
            let streamController = new StreamController(i, options, self);

            self.services.push(streamController.service);
            self.streamControllers.push(streamController);
        }
    }
};

module.exports = {
    FFMPEG
};
