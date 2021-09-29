require('dotenv').config()
const mqtt = require('mqtt');
const logger = require('winston');
const DeviceManager = require('./app/device_manager');

const networkAddress = process.env.NETWORK || '192.168.1.255';
const mqttServerAddress = process.env.MQTT_SERVER || 'mqtt://127.0.0.1';
const mqttBaseTopic = process.env.MQTT_BASE_TOPIC || 'ewpe-smart';
const pollInterval = process.env.DEVICE_POLL_INTERVAL || 5000;
const mqttServerUsername = process.env.MQTT_USERNAME || '';
const mqttServerpassword = process.env.MQTT_PASSWORD || '';
const mqttServerport = process.env.MQTT_PORT || 1883;


const customLogFormat = logger.format.printf(info => {
    const message = JSON.stringify(info.message).replace(/["\\]/g, '')
    return `${info.timestamp} [${info.level}]: ${message}`;
})

logger.configure({
    level: process.env.LOG_LEVEL || 'info',
    format: logger.format.combine(
        logger.format.timestamp(),
        logger.format.colorize(),
        logger.format.json(),
        customLogFormat
    ),
    transports: [
        new logger.transports.Console()
    ]
});

logger.info(`Trying to connect to MQTT server ${mqttServerAddress} ...`)
const mqttClient = mqtt.connect(mqttServerAddress, {
    username: mqttServerUsername,
    password: mqttServerpassword,
    port: mqttServerport
});

mqttClient.on('connect', () => {
    logger.info('Successfully connected to MQTT server');

    const deviceRegex = new RegExp(`^${mqttBaseTopic}\/([0-9a-h]{12})\/(.*)$`, 'i');
    const deviceManager = new DeviceManager(networkAddress, pollInterval);

    const getDeviceStatus = async (deviceId) => {
        const deviceStatus = await deviceManager.getDeviceStatus(deviceId);
        mqttClient.publish(`${mqttBaseTopic}/${deviceId}/status`, JSON.stringify(deviceStatus));
        if (deviceStatus["Pow"] == 0) {
            hoassMode = "off"
        } else {
            switch(deviceStatus["Mod"]) {
            case 0:
                hoassMode = "auto"
                break
            case 1:
                hoassMode = "cool"
                break
            case 2:
                hoassMode = "dry"
                break
            case 4:
                hoassMode = "fan_only"
                break
            case 5:
                hoassMode = "heat"
                break
            }
        }

        mqttClient.publish(`${mqttBaseTopic}/${deviceId}/hoass/mode/status`, hoassMode)
        mqttClient.publish(`${mqttBaseTopic}/${deviceId}/hoass/temp/status`, `${deviceStatus.SetTem}.0`)
        mqttClient.publish(`${mqttBaseTopic}/${deviceId}/hoass/temp/sensor`, `${deviceStatus.TemSen}.0`)
    }

    mqttClient.publish(`${mqttBaseTopic}/bridge/state`, 'online');
    mqttClient.subscribe(`${mqttBaseTopic}/#`);

    mqttClient.on('message', async (topic, message) => {
        let matches;

        logger.info(`MQTT message received: ${topic} ${message}`);

        if (topic === `${mqttBaseTopic}/devices/list`) {
            mqttClient.publish(`${mqttBaseTopic}/devices`, JSON.stringify(deviceManager.getDevices()))
        } else {
            matches = deviceRegex.exec(topic);

            if (matches !== null) {
                const [, deviceId, command] = matches;

                if (command === 'get') {
                    getDeviceStatus(deviceId);
                }

                if (command === 'set') {
                    const cmdResult = await deviceManager.setDeviceState(deviceId, JSON.parse(message));
                    mqttClient.publish(`${mqttBaseTopic}/${deviceId}/status`, JSON.stringify(cmdResult));
                }

                if (command === 'hoass/temp/set') {
                    var temp = parseInt(message, 10)
                    message = `{ "SetTem": ${temp} }`
                    const cmdResult = await deviceManager.setDeviceState(deviceId, JSON.parse(message));
                    mqttClient.publish(`${mqttBaseTopic}/${deviceId}/status`, JSON.stringify(cmdResult));
                }

                if (command === 'hoass/mode/set') {
                    if (message == "off") {
                        message = '{"Pow": 0}'
                    } else if ( message == "auto") {
                        message = '{"Pow": 1, "Mod": 0}'
                    } else if ( message == "cool") {
                        message = '{"Pow": 1, "Mod": 1}'
                    } else if ( message == "dry") {
                        message = '{"Pow": 1, "Mod": 2}'
                    } else if ( message == "fan_only") {
                        message = '{"Pow": 1, "Mod": 3}'
                    } else if ( message == "heat") {
                        message = '{"Pow": 1, "Mod": 4}'
                    } else {
                        logger.info(`Got unexpected message: '${message}'`)
                        return
                    }
                    const cmdResult = await deviceManager.setDeviceState(deviceId, JSON.parse(message));
                    mqttClient.publish(`${mqttBaseTopic}/${deviceId}/status`, JSON.stringify(cmdResult));
                }
            }
        }
    });

    deviceManager.on('device_bound', (deviceId, device) => {
        mqttClient.publish(`${mqttBaseTopic}/${deviceId}`, JSON.stringify(device));

        if (pollInterval > 0) {
            setInterval(() => getDeviceStatus(deviceId), pollInterval);
        }
    });
});

mqttClient.on('error', (error) => {
    logger.error(error);
});