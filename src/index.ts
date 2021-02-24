/*
 * Copyright 2021 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const camelCase = require('camelcase')
const path = require('path')
const shellies = require('shellies')

const deviceKey = (device: any) => `${device.type}-${device.id}`
const hasAnyRelays = (device: any) => device.hasOwnProperty('relay0')
const hasOneRelay = (device: any) =>
  device.hasOwnProperty('relay0') && !hasMultipleRelays(device)
const hasMultipleRelays = (device: any) => device.hasOwnProperty('relay1')
const MAX_RELAYS = 10

export default function (app: any) {
  const error = app.error
  const debug = app.debug
  let sentMetaDevices: any = {}
  let putsRegistred: any = {}
  let props: any
  let enabledDevices: any = {}

  const plugin: Plugin = {
    start: function (properties: any) {
      props = properties

      /*
      deviceTypes.forEach((type, idx) => {
        let device = shellies.createDevice(type, '1234' + idx, 'localhost')
        if (addDevice(device)) {
          enabledDevices[deviceKey(device)] = device
          sendDeltas(device)
        }
      })
      */

      shellies.on('discover', (device: any) => {
        debug(`discovered device ${device.id} ${device.type} @ ${device.host}`)

        sendDeltas(device)
        if (addDevice(device)) {
          enabledDevices[deviceKey(device)] = device

          device.on('change', (prop: any, newValue: any, oldValue: any) => {
            debug(
              `${device.id} ${prop} changed from ${oldValue} to ${newValue}`
            )
            sendDeltas(device)
          })

          device.on('offline', (device: any) => {
            debug(`device is offline ${device.id}`)
          })
        }
      })

      shellies.start()
    },

    stop: function () {
      putsRegistred = {}
      sentMetaDevices = {}
      enabledDevices = {}
    },

    id: 'signalk-shelly',
    name: 'Shelly',
    description: 'Signal K Plugin For Shelly devices',

    schema: () => {
      const schema: any = {
        type: 'object',
        properties: {}
      }

      let devices = Object.values(enabledDevices)
      //let devices = [...shellies]

      devices
        .filter((device: any) => hasAnyRelays(device))
        .forEach((device: any) => {
          let props: any = (schema.properties[
            `Device ID ${deviceKey(device)}`
          ] = {
            type: 'object',
            properties: {
              deviceName: {
                type: 'string',
                title: 'Name',
                default: `${device.modelName} ${device.name ?? ''}`,
                readOnly: true
              },
              enabled: {
                type: 'boolean',
                title: 'Enabled',
                default: true
              }
            }
          })

          if (hasMultipleRelays(device)) {
            props.properties.bankPath = {
              type: 'string',
              title: 'Bank Path',
              default: device.name ?? deviceKey(device),
              description:
                'Used to generate the path name, ie. electrical.switches.${bankPath}.0.state'
            }
          }

          for (let i = 0; i < MAX_RELAYS; i++) {
            const key = `relay${i}`
            if (!device.hasOwnProperty(key)) {
              break
            }
            let defaultPath
            let description
            if (hasMultipleRelays(device)) {
              defaultPath = i.toString()
              description =
                'Used to generate the path name, ie electrical.switches.${bankPath}.${switchPath}.state'
            } else {
              defaultPath = device.name || deviceKey(device)
              description =
                'Used to generate the path name, ie electrical.switches.${switchPath}.state'
            }

            props.properties[key] = {
              type: 'object',
              properties: {
                switchPath: {
                  type: 'string',
                  title: 'Switch Path',
                  default: defaultPath,
                  description
                },
                displayName: {
                  type: 'string',
                  title: 'Display Name (meta)'
                }
              }
            }
            if (hasMultipleRelays(device)) {
              props.properties[key].properties.enabled = {
                type: 'boolean',
                title: 'Enabled',
                default: true
              }
            }
          }
        })

      return schema
    }
  }

  function filterEnabledDevices (devices: any) {
    return [...shellies].filter((device: any) => {
      const deviceProps = getDeviceProps(device)
      return (
        !deviceProps ||
        typeof deviceProps.enabled === 'undefined' ||
        deviceProps.enabled
      )
    })
  }

  function addDevice (device: any) {
    const deviceProps = getDeviceProps(device)
    if (typeof deviceProps === 'undefined' || deviceProps.enabled) {
      putProperties.forEach(prop => {
        if (typeof device[prop] !== 'undefined') {
          const path = getDevicePath(device, prop)
          if (!putsRegistred[path]) {
            const setter = 'set' + prop.charAt(0).toUpperCase() + prop.slice(1)
            app.registerPutHandler(
              'vessels.self',
              path,
              (context: string, path: string, value: any, cb: any) => {
                return valueHandler(context, path, value, device, setter, cb)
              }
            )
            putsRegistred[path] = true
          }
        }
      })

      if (hasAnyRelays(device)) {
        for (let i = 0; i < MAX_RELAYS; i++) {
          const key = `relay${i}`
          if (!device.hasOwnProperty(key)) {
            break
          }
          const switchPath = getSwitchPath(device, i)
          if (!putsRegistred[switchPath]) {
            app.registerPutHandler(
              'vessels.self',
              switchPath,
              (context: string, path: string, value: any, cb: any) => {
                return switchHandler(context, path, value, device, i, cb)
              }
            )
            putsRegistred[switchPath] = true
          }
        }
      }
      return true
    }
  }

  function switchHandler (
    context: string,
    path: string,
    value: any,
    device: any,
    relay: number,
    cb: any
  ) {
    const state = value === 1 || value === 'on' || value === 'true'
    device
      .setRelay(relay, state)
      .then((res: any) => {
        cb({
          state: 'COMPLETED',
          statusCode: 200
        })
      })
      .catch((err: any) => {
        error(err)
        app.setPluginError(err.message)
        cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
      })
    return { state: 'PENDING' }
  }

  function valueHandler (
    context: string,
    path: string,
    value: any,
    device: any,
    setter: string,
    cb: any
  ) {
    const func = device[setter]
    if (!func) {
      return {
        state: 'COMPLETED',
        statusCode: 400,
        message: `no setter: ${setter}`
      }
    }
    func(value)
      .then((status: any) => {
        cb({
          state: 'COMPLETED',
          statusCode: 200
        })
      })
      .catch((err: any) => {
        error(err)
        app.setPluginError(err.message)
        cb({ state: 'COMPLETED', statusCode: 400, message: err.message })
      })
    return { state: 'PENDING' }
  }

  function sendMeta (device: any) {
    let meta: any = []

    if (hasAnyRelays(device)) {
      for (let relay = 0; relay < MAX_RELAYS; relay++) {
        const key = `relay${relay}`
        if (!device.hasOwnProperty(key)) {
          break
        }

        const switchProps = getSwitchProps(device, relay)
        meta.push({
          path: getSwitchPath(device),
          value: {
            displayName: switchProps?.displayName,
            units: 'bool'
          }
        })
        meta.push({
          path: getSwitchPath(device, 0, null),
          value: {
            displayName: switchProps?.displayName
          }
        })
      }
    }

    if (meta.length) {
      debug('sending meta: %j', meta)
      app.handleMessage(plugin.id, {
        updates: [
          {
            meta
          }
        ]
      })
    }
  }

  function sendDeltas (device: any) {
    let values = []

    if (!sentMetaDevices[deviceKey(device)]) {
      sendMeta(device)
      sentMetaDevices[deviceKey(device)] = true
    }

    let addValue: any = (key: string, path: any = null, v: any = null) => {
      const val = v !== null ? v : device[key]
      if (typeof val !== 'undefined' && val !== null) {
        values.push({
          path: getDevicePath(device, path || key),
          value: val
        })
      }
    }

    readProps.forEach(prop => addValue(prop))

    if (hasAnyRelays(device)) {
      for (let relay = 0; relay < MAX_RELAYS; relay++) {
        const key = `relay${relay}`
        if (!device.hasOwnProperty(key)) {
          break
        }

        values.push({
          path: getSwitchPath(device, relay),
          value: device[key] ? 1 : 0
        })

        let addValue: any = (key: string, path: string, v: any) => {
          const val = typeof v !== 'undefined' ? v : device[key]
          if (typeof val !== 'undefined' && val !== null) {
            values.push({
              path: getSwitchPath(device, relay, path || key),
              value: val
            })
          }
        }

        addValue('input0')
        addValue(`power${relay}`, 'power')
      }
    }

    if (values.length > 0) {
      app.handleMessage(plugin.id, {
        updates: [
          {
            values
          }
        ]
      })
    }
  }

  function getDeviceProps (device: any) {
    return props[`Device ID ${deviceKey(device)}`]
  }

  function getSwitchProps (device: any, relay: number = 0) {
    const devProps = getDeviceProps(device)
    return devProps ? devProps[`relay${relay}`] : undefined
  }

  function getDevicePath (device: any, key: any = 'state') {
    const devProps = getDeviceProps(device)

    if (hasMultipleRelays(device)) {
      return `electrical.switches.${devProps?.bankPath || deviceKey(device)}${
        key ? '.' + key : ''
      }`
    } else {
      const switchProps = getSwitchProps(device, 0)
      return `electrical.switches.${switchProps?.switchPath ||
        deviceKey(device)}${key ? '.' + key : ''}`
    }
  }

  function getSwitchPath (device: any, relay: number = 0, key: any = 'state') {
    const devProps = getDeviceProps(device)
    const switchProps = getSwitchProps(device, relay)

    if (hasMultipleRelays(device)) {
      return `electrical.switches.${devProps?.bankPath ||
        deviceKey(device)}.${switchProps?.switchPath || relay.toString()}${
        key ? '.' + key : ''
      }`
    } else {
      return `electrical.switches.${switchProps?.switchPath ||
        deviceKey(device)}${key ? '.' + key : ''}`
    }
  }

  return plugin
}

interface Plugin {
  start: (app: any) => void
  stop: () => void
  id: string
  name: string
  description: string
  schema: any
}

const putProperties = [
  'rollerState',
  'rollerPosition'
]

const readProps = [
  ...putProperties,
  'mode',
  'rollerStopReason',
  'externalTemperature0',
  'externalTemperature1',
  'externalTemperature2',
  'externalHumidity',
  'externalInput0'
]

const deviceTypes = [
  'SHSW-1',
  /*
  'SHSW-L',
  'SHSW-PM',
  'SHSW-21',
  'SHSW-25',
  'SH2LED-1',
  'SHEM-3',
  'SHSW-44',
  'SHAIR-1',
  'SHCB-1',
  'SHBLB-1',
  'SHBTN-2',
  'SHBTN-1',
  'SHCL-255',
  'SHDIMW-1',
  'SHDM-1',
  'SHDM-2',
  'SHDW-1',
  'SHDW-2',
  'SHBDUO-1',
  'SHEM',
  'SHWT-1',
  'SHGS-1',
  'SHSW-22',
  'SHHT-1',
  'SHIX3-1',
  'SHPLG2-1',
  'SHPLG-S',
  'SHPLG-U1',
  'SHPLG-1',
  'SHRGBWW-01',
  'SHRGBW2',
  'SHSEN-1',
  'SHSM-01',
  'SHSM-02',
  'SHUNI-1',
  'SHVIN-1'
  */
]
