#!/usr/bin/nodejs
// hikvision HTTP API Module

let net = require('net');
let events = require('events');
let util = require('util');
let xml2js = require('xml2js');

// Define Globals
let parser = new xml2js.Parser();

// Module Loader
let hikvision = function (options) {
    events.EventEmitter.call(this);
    this.client = this.connect(options);
    this.log = options.log;
    this.activeEvents = {};
    this.triggerActive = false
};

util.inherits(hikvision, events.EventEmitter);

// Attach to camera
hikvision.prototype.connect = function (options) {
    let self = this;
    let authHeader = 'Authorization: Basic ' + Buffer.of(options.user + ':' + options.pass).toString('base64');
    // Connect
    let client = net.connect(options, function () {
        let header = 'GET /ISAPI/Event/notification/alertStream HTTP/1.1\r\n' +
            'Host: ' + options.host + ':' + options.port + '\r\n' +
            authHeader + '\r\n' +
            'Accept: multipart/x-mixed-replace\r\n\r\n';
        client.write(header);
        client.setKeepAlive(true, 1000);
        handleConnection(self, options);
    });

    client.on('data', function (data) {
        handleData(self, data)
    });

    client.on('close', function () {// Try to reconnect after 30s
        setTimeout(function () {
            self.connect(options)
        }, 30000);
        handleEnd(self)
    });

    client.on('error', function (err) {
        handleError(self, err)
    });
};

// Handle alarms
function handleData(self, data) {
    parser.parseString(data, function (err, result) {
        if (result) {
            let code = result['EventNotificationAlert']['eventType'][0];
            let action = result['EventNotificationAlert']['eventState'][0];
            let index = parseInt(result['EventNotificationAlert']['channelID'][0]);
            let count = parseInt(result['EventNotificationAlert']['activePostCount'][0]);

            // give codes returned by camera prettier and standardized description
            if (code === 'IO') code = 'AlarmLocal';
            if (code === 'VMD') code = 'VideoMotion';
            if (code === 'linedetection') code = 'LineDetection';
            if (code === 'videoloss') code = 'VideoLoss';
            if (code === 'shelteralarm') code = 'VideoBlind';
            if (action === 'active') action = 'Start';
            if (action === 'inactive') action = 'Stop';

            // create and event identifier for each recieved event
            // This allows multiple detection types with multiple indexes for DVR or multihead devices
            let eventIdentifier = code + index;

            // Count 0 seems to indicate everything is fine and nothing is wrong, used as a heartbeat
            // if triggerActive is true, lets step through the activeEvents
            // If activeEvents has something, lets end those events and clear activeEvents and reset triggerActive
            if (count === 0) {
                if (self.triggerActive) {
                    for (let i in self.activeEvents) {
                        if (self.activeEvents.hasOwnProperty(i)) {
                            let eventDetails = self.activeEvents[i];
                            self.log.debug('Ending Event: ' + i + ' - ' + eventDetails["code"] + ' - ' + ((Date.now() - eventDetails["lasttimestamp"]) / 1000));
                            self.emit("alarm", eventDetails["code"], 'Stop', eventDetails["index"]);
                        }
                    }
                    self.activeEvents = {};
                    self.triggerActive = false
                } else {
                    // should be the most common result
                    // Nothing interesting happening and we haven't seen any events
                    self.log.debug("alarm", code, action, index);
                }
            }

            // if the first instance of an eventIdentifier, lets emit it,
            // add to activeEvents and set triggerActive
            else if (typeof self.activeEvents[eventIdentifier] === 'undefined' || self.activeEvents[eventIdentifier] == null) {
                let eventDetails = {};
                eventDetails["code"] = code;
                eventDetails["index"] = index;
                eventDetails["lasttimestamp"] = Date.now();

                self.activeEvents[eventIdentifier] = eventDetails;
                self.emit("alarm", code, action, index);
                self.triggerActive = true

                // known active events
            } else {
                self.log.debug('Skipped Event: ' + code + ' ' + action + ' ' + index + ' ' + count);

                // Update lasttimestamp
                let eventDetails = {};
                eventDetails["code"] = code;
                eventDetails["index"] = index;
                eventDetails["lasttimestamp"] = Date.now();
                self.activeEvents[eventIdentifier] = eventDetails;

                // step through activeEvents
                // if we haven't seen it in more than 2 seconds, lets end it and remove from activeEvents
                for (let i in self.activeEvents) {
                    if (self.activeEvents.hasOwnProperty(i)) {
                        let eventDetails = self.activeEvents[i];
                        if (((Date.now() - eventDetails["lasttimestamp"]) / 1000) > 2) {
                            self.log.debug('Ending Event: ' + i + ' - ' + eventDetails["code"] + ' - ' + ((Date.now() - eventDetails["lasttimestamp"]) / 1000));
                            self.emit("alarm", eventDetails["code"], 'Stop', eventDetails["index"]);
                            delete self.activeEvents[i]
                        }
                    }
                }
            }
        }
    });
}

// Handle connection
function handleConnection(self, options) {
    self.log.debug('Connected to ' + options.host + ':' + options.port);
    self.emit("connect");
}

// Handle connection ended
function handleEnd(self) {
    self.log.debug("Connection closed!");
    self.emit("end");
}

// Handle Errors
function handleError(self, err) {
    self.log.debug("Connection error: " + err);
    self.emit("error", err);
}

exports.hikvision = hikvision;
