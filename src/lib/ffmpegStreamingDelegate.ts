import ip from "ip";
import {ChildProcess, spawn} from "child_process";
import {
    AudioInfo,
    CameraController,
    CameraStreamingDelegate,
    HAP,
    Logging,
    PrepareStreamCallback,
    PrepareStreamRequest,
    PrepareStreamResponse,
    SnapshotRequest,
    SnapshotRequestCallback,
    SRTPCryptoSuites,
    StreamingRequest,
    StreamRequestCallback,
    StreamRequestTypes,
    StreamSessionIdentifier,
    VideoInfo
} from "homebridge";

let pathToFfmpeg = require('ffmpeg-for-homebridge');

type SessionInfo = {
    address: string, // address of the HAP controller

    videoPort: number,
    videoCryptoSuite: SRTPCryptoSuites, // should be saved if multiple suites are supported
    videoSRTP: Buffer, // key and salt concatenated
    videoSSRC: number, // rtp synchronisation source

    audioPort: number,
    audioCryptoSuite: SRTPCryptoSuites,
    audioSRTP: Buffer,
    audioSSRC: number,
}

const FFMPEGH264ProfileNames = [
    "baseline",
    "main",
    "high"
];
const FFMPEGH264LevelNames = [
    "3.1",
    "3.2",
    "4.0"
];

export class FfmpegStreamingDelegate implements CameraStreamingDelegate {
    private readonly hap: HAP;
    private readonly feedSupplier: Function;
    private readonly log: Logging;
    controller?: CameraController;

    pendingSessions: Record<string, SessionInfo> = {};
    ongoingSessions: Record<string, ChildProcess> = {};

    constructor(hap: HAP, feedSupplier: Function, log: Logging) {
        this.hap = hap;
        this.feedSupplier = feedSupplier;
        this.log = log;
    }

    handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
        const snapshotBuffers: Buffer[] = [];
        const resolution = request.width + 'x' + request.height;

        this.getVideoSource()
            .then(imageSource => {
                const ffmpegCommand = imageSource + ' -t 1 -s ' + resolution + ' -f mjpeg -'

                this.log.debug(ffmpegCommand);

                const ffmpeg = spawn(pathToFfmpeg, ffmpegCommand.split(" "), {env: process.env});

                ffmpeg.stdout.on('data', data => snapshotBuffers.push(data));
                ffmpeg.stderr.on('data', data => {
                    this.log.debug("Snapshot request: " + String(data));
                });

                ffmpeg.on('exit', (code, signal) => {
                    if (signal) {
                        this.log.error("Snapshot process was killed with signal", signal);
                        callback(new Error("killed with signal " + signal));
                    } else if (code === 0) {
                        this.log.debug(`Successfully captured snapshot at ${request.width}x${request.height}`);
                        callback(undefined, Buffer.concat(snapshotBuffers));
                    } else {
                        this.log.error("Snapshot process exited with code", code);
                        callback(new Error("Snapshot process exited with code " + code));
                    }
                });
            })
            .catch(reason => {
                this.log.error("Failed taking snapshot:", reason.message);
                callback(reason)
            });
    }

    prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
        const sessionId: StreamSessionIdentifier = request.sessionID;
        const targetAddress = request.targetAddress;

        const video = request.video;
        const videoPort = video.port;
        const videoCryptoSuite = video.srtpCryptoSuite; // could be used to support multiple crypto suite (or support no suite for debugging)
        const videoSrtpKey = video.srtp_key;
        const videoSrtpSalt = video.srtp_salt;
        const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

        const audio = request.audio;
        const audioPort = audio.port;
        const audioCryptoSuite = audio.srtpCryptoSuite;
        const audioSrtpKey = audio.srtp_key;
        const audioSrtpSalt = audio.srtp_salt;
        const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

        const sessionInfo: SessionInfo = {
            address: targetAddress,

            videoPort: videoPort,
            videoCryptoSuite: videoCryptoSuite,
            videoSRTP: Buffer.concat([videoSrtpKey, videoSrtpSalt]),
            videoSSRC: videoSSRC,

            audioCryptoSuite: audioCryptoSuite,
            audioPort: audioPort,
            audioSSRC: audioSSRC,
            audioSRTP: Buffer.concat([audioSrtpKey, audioSrtpSalt])
        };

        const currentAddress = ip.address("public", request.addressVersion); // ipAddress version must match
        const response: PrepareStreamResponse = {
            address: currentAddress,
            video: {
                port: videoPort,
                ssrc: videoSSRC,

                srtp_key: videoSrtpKey,
                srtp_salt: videoSrtpSalt,
            },
            audio: {
                port: audioPort,
                ssrc: audioSSRC,

                srtp_key: audioSrtpKey,
                srtp_salt: audioSrtpSalt
            }
        };

        this.pendingSessions[sessionId] = sessionInfo;

        callback(undefined, response);
    }


    handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
        this.log.debug("Stream request=", request);

        const sessionId = request.sessionID;

        switch (request.type) {
            case StreamRequestTypes.START:
                const sessionInfo = this.pendingSessions[sessionId];

                const video: VideoInfo = request.video;
                const audio: AudioInfo = request.audio;

                const profile = FFMPEGH264ProfileNames[video.profile];
                const level = FFMPEGH264LevelNames[video.level];
                const width = video.width;
                const height = video.height;
                const fps = video.fps;

                const payloadType = video.pt;
                const maxBitrate = video.max_bit_rate;
                const rtcpInterval = video.rtcp_interval; // usually 0.5
                const mtu = video.mtu; // maximum transmission unit

                const address = sessionInfo.address;
                const videoPort = sessionInfo.videoPort;
                const videoSsrc = sessionInfo.videoSSRC;
                const videoSRTP = sessionInfo.videoSRTP.toString("base64");

                const audioPort = sessionInfo.audioPort;
                const audioSsrc = sessionInfo.audioSSRC;
                const audioSRTP = sessionInfo.audioSRTP.toString("base64");
                const audioBitrate = audio.max_bit_rate;
                const audioPayloadType = audio.pt;

                this.getVideoSource()
                    .then(videoSource => {
                        let ffmpegCommand = videoSource +
                            ' -map 0:v' +
                            ' -vcodec ' + 'h264_mmal' +
                            ' -preset ultrafast' +
                            ' -pix_fmt yuv420p' +
                            ' -r ' + fps +
                            ' -f rawvideo' +
                            ' -tune zerolatency' +
                            //' -vf scale=' + width + ':' + height +
                            ' -b:v ' + maxBitrate + 'k' +
                            ' -bufsize ' + (2 * maxBitrate) + 'k' +
                            ' -maxrate ' + maxBitrate + 'k' +
                            ' -payload_type ' + payloadType +
                            ' -ssrc ' + videoSsrc +
                            ' -f rtp' +
                            ' -srtp_out_suite AES_CM_128_HMAC_SHA1_80' +
                            ' -srtp_out_params ' + videoSRTP +
                            ' srtp://' + address + ':' + videoPort + '?rtcpport=' + videoPort + '&localrtcpport=' + videoPort + '&pkt_size=' + 188;

                        //Audio
                        ffmpegCommand += ' -map 0:a?' +
                            ' -acodec ' + 'libfdk_aac' +
                            ' -preset ultrafast' +
                            ' -profile:a aac_eld' +
                            ' -flags +global_header' +
                            ' -f null' +
                            ' -ar ' + audioBitrate + 'k' +
                            ' -b:a ' + audioBitrate + 'k' +
                            ' -ac 1' +
                            ' -payload_type ' + audioPayloadType +
                            ' -ssrc ' + audioSsrc +
                            ' -f rtp' +
                            ' -srtp_out_suite AES_CM_128_HMAC_SHA1_80' +
                            ' -srtp_out_params ' + audioSRTP +
                            ' srtp://' + address + ':' + audioPort + '?rtcpport=' + audioPort + '&localrtcpport=' + audioPort + '&pkt_size=' + 188;

                        this.log.debug(ffmpegCommand);

                        const ffmpeg = spawn(pathToFfmpeg, ffmpegCommand.split(' '), {env: process.env});

                        let started = false;

                        ffmpeg.stderr.on('data', data => {
                            this.log.debug(data.toString());

                            if (!started) {
                                started = true;
                                callback();
                            }
                        });

                        ffmpeg.on('error', error => {
                            this.log.error("An error occurred while requesting the stream");
                            callback(new Error("ffmpeg process creation failed!"));
                        });

                        ffmpeg.on('exit', (code, signal) => {
                            if (code == null || code === 0 || code === 255) {
                                this.log.debug("Stream successfully closed");
                            } else {
                                if (!started) {
                                    callback(new Error("Stream closed with code " + code));
                                } else {
                                    this.controller!.forceStopStreamingSession(sessionId);
                                }
                            }
                        });

                        this.ongoingSessions[sessionId] = ffmpeg;
                    })
                    .catch(reason => {
                        this.log.error("Failed streaming from camera:", reason.message);
                        callback(reason)
                    });

                delete this.pendingSessions[sessionId];

                break;
            case StreamRequestTypes.RECONFIGURE:
                this.log.debug("Received (unsupported) request to reconfigure to: " + JSON.stringify(request.video));
                callback();
                break;
            case StreamRequestTypes.STOP:
                const ffmpegProcess = this.ongoingSessions[sessionId];

                try {
                    if (ffmpegProcess) {
                        ffmpegProcess.kill('SIGTERM');
                    }
                } catch (e) {
                    this.log.error("Error occurred terminating the video process.", e);
                }

                delete this.ongoingSessions[sessionId];

                this.log.debug("Stopped streaming session");
                callback();
                break;
        }
    }

    private async getVideoSource(): Promise<string> {
        let feed = await this.feedSupplier();

        this.log.debug("Feed=", feed);

        return "-vcodec h264 -fflags +igndts -i " + (feed.rtsp ?? feed.rtmp);
    }
}
