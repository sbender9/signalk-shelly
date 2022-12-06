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

import {
  Device,
  DeviceId,
  MdnsDeviceDiscoverer,
  Shellies,
  ShellyPlus1,
  CharacteristicValue,
} from 'shellies-ng';
let shelliesNg

const deviceKey = (device: any) => `${device.type || device.modelName}-${device.id}`

export default function (app: any) {
  const error = app.error
  const debug = app.debug
  let sentMetaDevices: any = {}
  let props: any
  let enabledDevices: any = {}
  let onStop: any = []
  let startedOnce = false
  let stopped = true

  const plugin: Plugin = {
    start: function (properties: any) {
      props = properties

      //let tests = Object.keys(deviceTypes)
      /*
      let tests = [ 'SHEM', 'SHEM-3' ] // ['SHSW-44', 'SHRGBWW-01', 'SHSW-1']
      tests.forEach((type: any, idx: number) => {
        let midx = type.indexOf(':')
        let mode
        if (midx !== -1) {
          mode = type.slice(midx+1)
          type = type.slice(0, midx)
        }
        let device = shellies.createDevice(type, '1234' + idx, 'localhost')
        if  ( mode ) {
          device.mode = mode
        }
        if (addDevice(device)) {
          enabledDevices[deviceKey(device)] = device
          sendDeltas(device)
        }
      })
      */

      /*
      let tdevice = {id: '12345', modelName: 'Shelly Plus 2 PM'}
      addDevice(tdevice)
      sendDeltas(tdevice)
      */

      let onDiscover = (device: any) => {
        debug(`discovered device ${device.id} ${device.type || device.modelName} @ ${device.host}`)

        if (addDevice(device)) {
          enabledDevices[deviceKey(device)] = device

          if ( device.type ) {
            let onChange = (prop: any, newValue: any, oldValue: any) => {
              if (!stopped) {
                debug(
                  `${device.id} ${prop} changed from ${oldValue} to ${newValue}`
                )
                sendDeltas(device)
              }
            }
            
            device.on('change', onChange)
          } 

          /*
          device.on('offline', () => {
            debug('device ' + device.id + ' went offline')
            delete enabledDevices[deviceKey(device)]
          })
          */


          if (!stopped) {
            sendDeltas(device)
          }
        }
      }

      let onNgDiscover = (device: Device) => {
        console.log(`${device.modelName} discovered`);
        console.log(`ID: ${device.id}`);

        let s = device['switch0']
        console.log(s['output'])
        if (device instanceof ShellyPlus1) {
          const plus1 = device as ShellyPlus1;
        }
      }

      stopped = false

      if (!startedOnce) {
        shellies.on('discover', onDiscover)
        shellies.start()

        shelliesNg = new Shellies({
          deviceOptions: (deviceId: any) => {
            if ( props.nextGenPassswords ) {
              let dev = props.nextGenPassswords.find((dev: any) => {
                return dev.id === deviceId
              })
              return { password: dev?.password }
            } else {
              return undefined
            }
          },
          autoLoadStatus: true,
          autoLoadConfig: false
        });
        shelliesNg.on('add', onDiscover)
        shelliesNg.on('error', (deviceId: DeviceId, error: Error) => {
          app.error(error.message)
          app.error(error.stack)
          app.setPluginError(error.message)
        });

        const discoverer = new MdnsDeviceDiscoverer();
        // register it
        shelliesNg.registerDiscoverer(discoverer);
        // start discovering devices
        discoverer.start();
        
        startedOnce = true
      }
      /*
      onStop.push(() => {
        shellies.stop()
        })*/
      /*
      onStop.push(setInterval(() => {
        Object.values(enabledDevices).forEach((device:any) => {
          debug('device %s online %s (%d)', device.id, device.online, device.ttl)
          if ( device.online ) {
            sendDeltas(device)
          }
        })
      }, 10000))
      */
    },

    stop: function () {
      sentMetaDevices = {}
      //enabledDevices = {}
      onStop.forEach((f: any) => f())
      onStop = []
      stopped = true
    },

    id: 'signalk-shelly',
    name: 'Shelly',
    description: 'Signal K Plugin For Shelly devices',

    schema: () => {
      const schema: any = {
        type: 'object',
        properties: {
          tempUnits: {
            type: 'string',
            title: 'Temperature Units',
            description: 'the untis the shelly devices send',
            enum: ['F', 'C'],
            enumNames: ['Fahrenheit', 'Celcius'],
            default: 'F'
          }
        }
      }

      let devices = Object.values(enabledDevices)

      devices.forEach((device: any) => {
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
            },
            devicePath: {
              type: 'string',
              title: 'Device Path',
              default: device.name ?? deviceKey(device),
              description:
                'Used to generate the path name, ie. electrical.switches.${devicePath}'
            },
            displayName: {
              type: 'string',
              title: 'Display Name (meta)'
            }
          }
        })

        const info = getDeviceInfo(device)

        if (!info) {
          return
        }
        
        if ( !info.nextGen ) {
          props.properties.userName = { 
            type: 'string',
            title: 'User Name'
          },
          props.properties.password = {
            type: 'string',
            title: 'Password'
          }
        }

        if (info.isSwitchBank) {
          for (let i = 0; i < info.switchCount; i++) {
            const key = `${info.switchKey}${i}`
            let defaultPath
            let description
            defaultPath = i.toString()
            description =
              'Used to generate the path name, ie electrical.switches.${bankPath}.${switchPath}.state'

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
                },
                enabled: {
                  type: 'boolean',
                  title: 'Enabled',
                  default: true
                }
              }
            }
          }
        }

        if (info.isRGBW) {
          props.properties.presets = {
            title: 'Presets',
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'red', 'green', 'blue', 'white', 'bright'],
              properties: {
                name: {
                  type: 'string',
                  title: 'Name'
                },
                red: {
                  type: 'number',
                  title: 'Red',
                  default: 255
                },
                green: {
                  type: 'number',
                  title: 'Green',
                  default: 255
                },
                blue: {
                  type: 'number',
                  title: 'Blue',
                  default: 255
                },
                white: {
                  type: 'number',
                  title: 'White',
                  default: 255
                },
                bright: {
                  type: 'number',
                  title: 'Brightness',
                  description:
                    'Number between 1-100. Set to 0 to preserve current brightness',
                  default: 100
                }
              }
            }
          }
        }
      })

      schema.properties.nextGenPassswords = {
        title: 'Next Gen Device Passwords',
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'password'],
          properties: {
            id: {
              type: 'string',
              title: 'Device Id'
            },
            password: {
              type: 'string',
              title: 'Password'
            }
          }
        }
      }

      return schema
    },

    uiSchema: () => {
      const uiSchema: any = {}
      let devices = Object.values(enabledDevices)

      devices.forEach((device: any) => {
        uiSchema[`Device ID ${deviceKey(device)}`] = {
          password: {
            'ui:widget': 'password'
          }
        }
      })

      return uiSchema
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
    const info = getDeviceInfo(device)

    if (!info) {
      return false
    }

    const deviceProps = getDeviceProps(device)

    if (deviceProps?.enabled === false) {
      return
    }

    if (deviceProps?.userName && deviceProps?.password && !info.nextGen ) {
      device.shelly.setAuth(deviceProps.password)
    }

    if (info.isSwitchBank) {
      for (let i = 0; i < info.switchCount; i++) {
        const switchProps = getSwitchProps(device, i)

        if (switchProps?.enabled === false) {
          continue
        }

        const path = getSwitchPath(device, i)

        app.registerPutHandler(
          'vessels.self',
          path,
          (context: string, path: string, value: any, cb: any) => {
            return valueHandler(
              context,
              path,
              value,
              device,
              (device: any, value: any) => {
                return info.switchSetter(device, value, i)
              },
              cb
            )
          }
        )

        if ( info.nextGen ) {
          let attrName = `${info.switchKey}${i}`
          device[attrName].on('change:output', (newValue) => {
            if ( !stopped ) {
              debug(
                `${device.id} ${attrName} changed to ${newValue}`
              )
              sendDeltas(device)
            }
          })
        }
        
        if ( info.bankReadPaths ) {
          let readPaths = info.bankReadPaths(`${info.switchKey}${i}`)
          readPaths?.forEach((prop: any) => {
            let key, path
      
            if (typeof prop === 'string') {
              path = key = info
            } else {
              key = prop.key
              path = prop.path ? prop.path : prop.key
            }
            
            let split = key.split('.')
            let attrName = split[split.length-1]
            
            if ( split.length > 1 ) {
              if ( device[split[0]] ) {
                device[split[0]].on(`change:${attrName}`, (newValue: any) => {
                  if ( !stopped ) {
                    debug(
                      `${device.id} ${key} changed to ${JSON.stringify(newValue)}`
                    )
                    sendDeltas(device)
                  }
                })
              }
            } else {
              device.on(`change:${attrName}`, (newValue: any) => {
                if ( !stopped ) {
                  debug(
                    `${device.id} ${key} changed to ${newValue}`
                  )
                  sendDeltas(device)
                }
              })
            }
          })
        }

        if (info.isDimmable) {
          const dimmerPath = getSwitchPath(device, i, 'dimmingLevel')

          app.registerPutHandler(
            'vessels.self',
            dimmerPath,
            (context: string, path: string, value: any, cb: any) => {
              return valueHandler(
                context,
                path,
                value,
                device,
                (device: any, value: any) => {
                  return info.dimmerSetter(device, value, i)
                },
                cb
              )
            }
          )
        }
      }
    }

    info.putPaths?.forEach((prop: any) => {
      const path = `${getDevicePath(device)}.${prop.name || prop.deviceProp}`
      app.registerPutHandler(
        'vessels.self',
        path,
        (context: string, path: string, value: any, cb: any) => {
          return valueHandler(context, path, value, device, prop.setter, cb)
        }
      )
      if ( info.nextGen ) {
        device[prop.deviceProp].on('change:output', (newValue) => {
          if ( !stopped ) {
            debug(
              `${device.id} ${prop.deviceProp} changed to ${newValue}`
            )
            sendDeltas(device)
          }
        })
      }
    })

    info.readPaths?.forEach((prop: any) => {
      if ( info.nextGen ) {
        let key, path
      
        if (typeof prop === 'string') {
          path = key = info
        } else {
          key = prop.key
          path = prop.path ? prop.path : prop.key
        }

        let split = key.split('.')
        let attrName = split[split.length-1]

        if ( split.length > 1 ) {
          if ( device[split[0]] ) {
            device[split[0]].on(`change:${attrName}`, (newValue: any) => {
              if ( !stopped ) {
                debug(
                  `${device.id} ${key} changed to ${newValue}`
                )
                sendDeltas(device)
              }
            })
          }
        } else {
          device.on(`change:${attrName}`, (newValue: any) => {
            if ( !stopped ) {
              debug(
                `${device.id} ${key} changed to ${newValue}`
              )
              sendDeltas(device)
            }
          })
        }
      }
    })

    return true
  }

  function valueHandler (
    context: string,
    path: string,
    value: any,
    device: any,
    func: any,
    cb: any
  ) {
    func(device, value)
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

    const info = getDeviceInfo(device)
    const deviceProps = getDeviceProps(device)
    const devicePath = getDevicePath(device)

    if (deviceProps?.enabled === false) {
      return
    }

    if (deviceProps?.displayName) {
      meta.push({
        path: devicePath,
        value: {
          displayName: deviceProps.displayName
        }
      })
    }

    if (info.isSwitchBank) {
      for (let i = 0; i < info.switchCount; i++) {
        const switchProps = getSwitchProps(device, i)

        if (switchProps?.enabled === false) {
          continue
        }

        meta.push({
          path: getSwitchPath(device, i),
          value: {
            units: 'bool',
            displayName: switchProps?.displayName,
            timeout: device.ttl ? (device.ttl / 1000) : undefined
          }
        })
        if ( info.bankReadPaths ) {
          let readPaths = info.bankReadPaths(`${info.switchKey}${i}`)
          readPaths?.forEach((p: any) => {
            if ( p.meta ) {
              meta.push({
                path: getSwitchPath(device, i, p.path),
                value: p.meta
              })
            }
          })
        }
        if (info.isDimmable) {
          meta.push({
            path: getSwitchPath(device, i, 'dimmingLevel'),
            value: {
              units: 'ratio',
              displayName: switchProps?.displayName,
              type: 'dimmer',
              canDimWhenOff: info.canDimWhenOff
            }
          })
        }
        if (switchProps?.displayName) {
          meta.push({
            path: getSwitchPath(device, i, null),
            value: {
              displayName: switchProps?.displayName
            }
          })
        }
        const powerKey = `power${i}`
        if (typeof device[powerKey] !== 'undefined') {
          meta.push({
            path: getSwitchPath(device, i, 'power'),
            value: {
              units: 'W'
            }
          })
        }
      }
    }

    info.putPaths?.forEach((prop: any) => {
      if ( device.ttl ) {
        meta.push({
          path: `${devicePath}.${prop.name || prop.deviceProp}`,
          value: {
            timeout: device.ttl / 1000
          }
        })
      }
      if (deviceProps?.displayName || prop.meta) {
        meta.push({
          path: `${devicePath}.${prop.name || prop.deviceProp}`,
          value: {
            ...prop.meta,
            displayName: deviceProps?.displayName
          }
        })
        if (deviceProps?.displayName) {
          meta.push({
            path: devicePath,
            value: {
              displayName: deviceProps?.displayName
            }
          })
        }
        if (deviceProps?.presets && deviceProps.presets.length > 0) {
          meta.push({
            path: `${devicePath}.preset`,
            value: {
              displayName: deviceProps?.displayName,
              possibleValues: [
                ...deviceProps.presets.map((preset: any) => {
                  return {
                    title: preset.name,
                    value: preset.name
                  }
                })
              ],
              enum: [...deviceProps.presets.map((preset: any) => preset.name)]
            }
          })
        }
      }
    })

    info.readPaths?.forEach((prop: any) => {
      let key, path
      
      if (typeof prop === 'string') {
        path = key = prop
      } else {
        key = prop.key
        path = prop.path ? prop.path : prop.key
      }

      let split = key.split('.')
      key = split[split.length-1]
      
      if ( device.ttl ) {
        meta.push({
          path: `${devicePath}.${path}`,
          value: {
            timeout: device.ttl / 1000
          }
        })
      }
      if ( typeof prop !== 'string' && prop.meta) {
        meta.push({
          path: `${devicePath}.${path}`,
          value: prop.meta
        })
      }
      if (key.startsWith('power')) {
        meta.push({
          path: `${devicePath}.${path}`,
          value: {
            units: 'W'
          }
        })
      }
      if (key.startsWith('externalTemperature') || key.startsWith('temperature') || key === 'deviceTemperature') {
        meta.push({
          path: `${devicePath}.${path}`,
          value: {
            units: 'K'
          }
        })
      }
    })

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
    let values: any = []

    const deviceProps = getDeviceProps(device)

    if (deviceProps?.enabled === false) {
      return
    }

    if (!sentMetaDevices[deviceKey(device)]) {
      sendMeta(device)
      sentMetaDevices[deviceKey(device)] = true
    }

    const info = getDeviceInfo(device)

    if (info.isSwitchBank) {
      for (let i = 0; i < info.switchCount; i++) {
        const switchProps = getSwitchProps(device, i)

        if (switchProps?.enabled === false) {
          continue
        }

        const key = `${info.switchKey}${i}`
        const val = info.nextGen ? (device[key] ? device[key].output : null) : device[key]
        values.push({
          path: getSwitchPath(device, i),
          value: val ? 1 : 0
        })

        if ( info.bankReadPaths ) {
          let readPaths = info.bankReadPaths(`${info.switchKey}${i}`)
          readPaths?.forEach((info: any) => {
            let path, key, converter
            if (typeof info === 'string') {
              path = key = info
            } else {
              key = info.key
              path = info.path ? info.path : info.key
              converter = info.converter
            }
            let val
            if ( key.indexOf('.') !== -1 ) {
              let split =  key.split('.')
              val = device
              split.forEach((k: any) => {
                if ( typeof val === 'undefined' ) {
                  val = undefined
                } else {
                  val = val[k]
                }
              })
            } else {
              val = device[key]
            }
            if (val != null) {
              values.push({
                path: getSwitchPath(device, i, path),
                value: converter ? converter(val) : val
              })
            }
          })
        }

        if (info.isDimmable) {
          const dimmerKey = `brightness${i}`
          values.push({
            path: getSwitchPath(device, i, 'dimmingLevel'),
            value: Number((device[dimmerKey] / 100).toFixed(2))
          })
        }
        const powerKey = `power${i}`
        if (typeof device[powerKey] !== 'undefined') {
          values.push({
            path: getSwitchPath(device, i, 'power'),
            value: device[powerKey]
          })
        }
      }
    }

    info.putPaths?.forEach((prop: any) => {
      const path = `${getDevicePath(device)}.${prop.name || prop.deviceProp}`
      let value
      if (!prop.deviceProp) {
        value = prop.getter(device)
      } else {
        value = prop.convertFrom
          ? prop.convertFrom(device[prop.deviceProp], device)
          : device[prop.deviceProp]
      }
      values.push({
        path,
        value
      })
    })

    info.readPaths?.forEach((info: any) => {
      let path, key, converter
      if (typeof info === 'string') {
        path = key = info
      } else {
        key = info.key
        path = info.path ? info.path : info.key
        converter = info.converter
      }
      let val
      if ( key.indexOf('.') !== -1 ) {
        let split =  key.split('.')
        val = device
        split.forEach((k: any) => {
          if ( typeof val === 'undefined' ) {
            val = undefined
          } else {
            val = val[k]
          }
        })
      } else {
        val = device[key]
      }
      if (val != null) {
        values.push({
          path: `${getDevicePath(device)}.${path}`,
          value: converter ? converter(val) : val
        })
      }
    })

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

  function getSwitchProps (device: any, relay: number) {
    const info = getDeviceInfo(device)
    const devProps = getDeviceProps(device)

    if (info.isSwitchBank) {
      return devProps ? devProps[`${info.switchKey}${relay}`] : undefined
    } else {
      return devProps
    }
  }

  function getSwitchPath (device: any, relay: any, key: any = 'state') {
    const info = getDeviceInfo(device)
    const devProps = getDeviceProps(device)
    const switchProps = getSwitchProps(device, relay)

    let path = `electrical.switches.${devProps?.devicePath ||
      deviceKey(device)}`
    if (info.isSwitchBank) {
      path = path + `.${switchProps?.switchPath || relay}`
    }

    return path + (key ? '.' + key : '')
  }

  function getDevicePath (device: any) {
    const devProps = getDeviceProps(device)
    return `electrical.switches.${devProps?.devicePath || deviceKey(device)}`
  }

  function getDeviceInfo (device: any) {
    const modeKey = device.mode
    let info

    if (modeKey && deviceTypes[`${device.type}:${modeKey}`]) {
      return deviceTypes[`${device.type}:${modeKey}`]
    } else {
      return deviceTypes[device.type || device.modelName]
    }
  }

  const rgbwPutPaths = [
    {
      deviceProp: 'switch',
      name: 'state',
      setter: (device: any, value: any) => {
        return device.setColor({
          turn: boolString(value)
        })
      },
      convertFrom: (value: any) => {
        return value === true ? 1 : 0
      },
      meta: {
        units: 'bool'
      }
    },
    {
      //deviceProp: 'gain',
      name: 'dimmingLevel',
      setter: (device: any, value: any) => {
        if ( device.white > 0 ) {
          let white = device.white / 255
          let gain = device.gain /100

          if ( white < gain ) {
            white = white + value - gain
          } else {
            white = value
            value = gain + value - white
          }
          if ( white <= 0 ) {
            white = 0.01
          }
          device.setColor({
            white: white * 255
          })
        }

        if  ( value <= 0 ) {
          value = 0.01
        }
        
        return device.setColor({
          gain: Number((value * 100).toFixed(0))
        })
      },
      getter: (device: any) => {
        let value = device.gain / 100
        if ( device.red === 0 && device.green === 0 && device.blue === 0 ) {
          value = (device.white/255) * 100
        } else if ( device.gain > 0 && device.white > 0 ) {
          value = device.white > device.gain ? device.white / 255 : value
        }
        return Number(value.toFixed(2))
      },
      meta: {
        units: 'ratio',
        type: 'dimmer',
        canDimWhenOff: true
      }
    },
    {
      deviceProp: 'red',
      setter: (device: any, value: any) => {
        return device.setColor({
          red: value
        })
      },
      meta: {
        units: 'rgbColor',
        range: [ 0, 255 ]
      }
    },
    {
      deviceProp: 'green',
      setter: (device: any, value: any) => {
        return device.setColor({
          green: value
        })
      },
      meta: {
        units: 'rgbColor',
        range: [ 0, 255 ]
      }
    },
    {
      deviceProp: 'blue',
      setter: (device: any, value: any) => {
        return device.setColor({
          blue: value
        })
      },
      meta: {
        units: 'rgbColor',
        range: [ 0, 255 ]
      }
    },
    {
      deviceProp: 'white',
      setter: (device: any, value: any) => {
        return device.setColor({
          white: value
        })
      },
      meta: {
        units: 'rgbColor',
        range: [ 0, 255 ]
      }
    },
    {
      name: 'preset',
      getter: (device: any) => {
        const deviceProps = getDeviceProps(device)
        const preset = deviceProps?.presets?.find((preset: any) => {
          return (
            device.red == preset.red &&
            device.green == preset.green &&
            device.blue == preset.blue &&
            device.white == preset.white &&
            (preset.bright === 0 || device.gain == preset.bright)
          )
        })
        return preset?.name || 'Unknown'
      },
      setter: (device: any, value: any) => {
        const deviceProps = getDeviceProps(device)
        const preset = deviceProps?.presets.find(
          (preset: any) => preset.name == value
        )
        if (value === 'Unknown' || !preset) {
          throw new Error(`invalid value ${value}`)
        } else {
          const params: any = {
            red: preset.red,
            green: preset.green,
            blue: preset.blue,
            white: preset.white,
            turn: 'on'
          }
          if (preset.bright !== 0) {
            params.gain = preset.bright
          }
          return device.setColor(params)
        }
      }
    }
  ]

  const simpleRelayPutPaths = [
    {
      deviceProp: 'relay0',
      name: 'state',
      setter: (device: any, value: any) => {
        return device.setRelay(0, boolValue(value))
      },
      convertFrom: (value: any) => {
        return value ? 1 : 0
      },
      meta: {
        units: 'bool'
      }
    }
  ]

  const simpleRelayReadPaths = ['input0']

  const nextgenSwitchPutPaths = (key: any) => {
    return [
      {
        deviceProp: key,
        name: 'state',
        setter: (device: any, value: any) => {
          return device[key].set(boolValue(value))
        },
        convertFrom: (value: any) => {
          return value.output ? 1 : 0
        },
        meta: {
          units: 'bool'
          }
      }
    ]
  }

  const nextgenSwitchReadPaths = (key: any) => {
    return [
      {
        key: `${key}.voltage`,
        path: 'voltage',
        meta: {
          units: 'V'
        }
      },
      {
        key: `${key}.temperature`,
        path: 'temperature',
        converter: nextgenTemperatureConverter,
        meta: {
          units: 'K'
        }
      },
      {
        key: `${key}.source`,
        path: 'source',
        meta: {
          units: 'string'
        }
      },
      {
        key: `${key}.apower`,
        path: 'apower',
        meta: {
          units: 'W'
        }
      },
      {
        key: `${key}.current`,
        path: 'current',
        meta: {
          units: 'A'
        }
      },
      {
        key: `${key}.pf`,
        path: 'powerFactor',
        converter: (val:any) => {
          return val * 1000
        },
        meta: {
          units: 'W'
        }
      }
    ]
  }

  const nextgenInputPaths = (key: any) => {
    return [
      {
        key: `${key}.state`,
        path: key,
        converter: (value: any) => {
          return value ? 1 : 0
        },
        meta: {
          units: 'bool'
        }
      }
    ]
  }
    
  const simpleRelay = {
    putPaths: simpleRelayPutPaths,
    readPaths: simpleRelayReadPaths
  }

  const temperatureConverter = (value: any) => {
    if (props?.tempUnits === 'C') {
      return value + 273.15
    } else {
      return ((value - 32) * 5) / 9 + 273.15
    }
  }

  const nextgenTemperatureConverter = (value: any) => {
    return value?.tC + 273.15
  }

  const humidityConverter = (value: any) => {
    return value / 100
  }

  const deviceTypes: any = {
    /* For testing bank stuff */
    /*
    'Shelly Plus 1': {
      nextGen: true,
      isSwitchBank: true,
      switchCount: 1,
      switchKey: 'switch',
      isDimmable: false,
      bankReadPaths: nextgenSwitchReadPaths,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device[`switch${switchIdx}`].set(boolValue(value))
      },
      readPaths: [
        ...nextgenInputPaths('input0')
      ]
    },
    */
    
    'Shelly Plus 1': {
      nextGen: true,
      putPaths: nextgenSwitchPutPaths('switch0'),
      readPaths: [
        ...nextgenSwitchReadPaths('switch0'),
        ...nextgenInputPaths('input0')
      ]
    },
    'Shelly Plus 1 PM': {
      nextGen: true,
      putPaths: nextgenSwitchPutPaths('switch0'),
      readPaths: [
        ...nextgenSwitchReadPaths('switch0'),
        ...nextgenInputPaths('input0')
      ]
    },
    'Shelly Pro 1': {
      nextGen: true,
      putPaths: nextgenSwitchPutPaths('switch0'),
      readPaths: [
        ...nextgenSwitchReadPaths('switch0'),
        ...nextgenInputPaths('input0'),
        ...nextgenInputPaths('input1')
      ]
    },
    'Shelly Pro 1 PM': {
      nextGen: true,
      putPaths: nextgenSwitchPutPaths('switch0'),
      readPaths: [
        ...nextgenSwitchReadPaths('switch0'),
        ...nextgenInputPaths('input0'),
        ...nextgenInputPaths('input1')
      ]
    },
    'Shelly Plus 2 PM': {
      nextGen: true,
      isSwitchBank: true,
      switchCount: 2,
      switchKey: 'switch',
      isDimmable: false,
      bankReadPaths: nextgenSwitchReadPaths,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device[`switch${switchIdx}`].set(boolValue(value))
      },
      readPaths: [
        ...nextgenInputPaths('input0'),
        ...nextgenInputPaths('input1')
      ]
    },
    'Shelly Pro 4 PM': {
      nextGen: true,
      isSwitchBank: true,
      switchCount: 4,
      switchKey: 'switch',
      isDimmable: false,
      bankReadPaths: nextgenSwitchReadPaths,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device[`switch${switchIdx}`].set(boolValue(value))
      },
      readPaths: [
        ...nextgenInputPaths('input0'),
        ...nextgenInputPaths('input1'),
        ...nextgenInputPaths('input2'),
        ...nextgenInputPaths('input3')
      ]
    },
    'Shelly Plus I4': {
      nextGen: true,
      readPaths: [
        ...nextgenInputPaths('input0'),
        ...nextgenInputPaths('input1'),
        ...nextgenInputPaths('input2'),
        ...nextgenInputPaths('input3'),
      ]
    },
    
    'SHSW-1': {
      putPaths: simpleRelayPutPaths,
      readPaths: [
        ...simpleRelayReadPaths,
        {
          key: 'externalTemperature0',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature1',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature2',
          converter: temperatureConverter
        }
      ]
    },
    'SHRGBWW-01': {
      isRGBW: true,
      putPaths: rgbwPutPaths
    },
    'SHRGBW2:white': {
      isSwitchBank: true,
      switchCount: 4,
      switchKey: 'switch',
      isDimmable: true,
      canDimWhenOff: true,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setWhite(
          switchIdx,
          undefined,
          value === 1 || value === 'on' || value === 'true' || value === true
        )
      },
      dimmerSetter: (device: any, value: any, switchIdx: number) => {
        return device.setWhite(
          switchIdx,
          Number((value * 100).toFixed(0)),
          device[`switch${switchIdx}`]
        )
      }
    },
    'SHRGBW2:color': {
      isRGBW: true,
      putPaths: rgbwPutPaths,
      readPaths: [
        'mode',
        'overPower',
        'input0',
        'power0',
        'power1',
        'power2',
        'power3'
      ]
    },
    'SHSW-44': {
      isSwitchBank: true,
      switchCount: 4,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      }
    },

    'SHSW-L': {
      putPaths: simpleRelayPutPaths,
      readPaths: [
        ...simpleRelayReadPaths,
        'input1',
        'power0',
        'energyCounter0',
        'deviceTemperature',
        'overTemperature'
      ]
    },

    'SHSW-PM': {
      putPaths: simpleRelayPutPaths,
      readPaths: [
        ...simpleRelayReadPaths,
        'power0',
        'energyCounter0',
        'overPower',
        'overPowerValue',
        'deviceTemperature',
        'overTemperature'
      ]
    },

    'SHSW-21:relay': {
      isSwitchBank: true,
      switchCount: 2,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      },
      readPaths: [
        'mode',
        'energyCounter0',
        'overPower0',
        'overPower1',
        'overPowerValue'
      ]
    },

    'SHUNI-1': {
      isSwitchBank: true,
      switchCount: 2,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      },
      readPaths: [
        'input0',
        'inputEvent0',
        'inputEventCounter0',
        'input1',
        'inputEvent1',
        'inputEventCounter1',
        {
          key: 'externalTemperature0',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature1',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature2',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature3',
          converter: temperatureConverter
        },
        {
          key: 'externalTemperature4',
          converter: temperatureConverter
        },
        'voltage0',
        {
          key: 'externalHumidity',
          converter: humidityConverter,
          meta: {
            units: 'ratio',
          }
        }
      ]
    },

    'SHHT-1': {
      readPaths: [
        {
          key: 'temperature',
          converter: temperatureConverter
        },
        {
          key: 'humidity',
          converter: humidityConverter,
          meta: {
            units: 'ratio',
          }
        },
        'battery'
      ]
    },
    
    SHEM: {
      isSwitchBank: true,
      switchCount: 1,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      },
      readPaths: [
        'power0',
        'energyCounter0',
        'energyReturned0',
        'voltage0',
        'power1',
        'energyCounter1',
        'energyReturned1',
        'voltage1',
        'overPower'
      ]
    },

    'SHEM-3': {
      isSwitchBank: true,
      switchCount: 1,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      },
      readPaths: [
        'power0',
        'energyCounter0',
        'energyReturned0',
        'powerFactor0',
        'current0',
        'voltage0',
        'power1',
        'energyCounter1',
        'energyReturned1',
        'powerFactor1',
        'current1',
        'voltage1',
        'power2',
        'energyCounter2',
        'energyReturned2',
        'powerFactor2',
        'current2',
        'voltage2',
        'overPower'
      ]
    },

    'SHSW-21:roller': {
      readPaths: [
        'mode',
        'power0',
        'energyCounter0',
        'overPower0',
        'overPower1',
        'overPowerValue'
      ],
      putPaths: [
        {
          deviceProp: 'rollerState',
          setter: (device: any, value: any) => {
            return device.setRollerState(value)
          }
        },
        {
          deviceProp: 'rollerPosition',
          setter: (device: any, value: any) => {
            return device.setRollerPosition(value)
          }
        }
      ]
    },

    'SHSW-22': {
      isSwitchBank: true,
      switchCount: 2,
      switchKey: 'relay',
      isDimmable: false,
      switchSetter: (device: any, value: any, switchIdx: number) => {
        return device.setRelay(switchIdx, boolValue(value))
      }
    },

    'SHPLG2-1': simpleRelay,
    'SHPLG-S': simpleRelay,
    'SHPLG-U1': simpleRelay,

    'SHPLG-1': {
      putPaths: simpleRelayPutPaths,
      readPaths: [
        ...simpleRelayReadPaths,
        'power0',
        'energyCounter0',
        'overPower',
        'overPowerValue'
      ]
    },

    'SHDW-1': {
      readPaths: [
        'state',
        'vibration',
        'illuminance',
        'illuminanceLevel',
        'sensorError',
        'battery',
        'wakeupEvent'
      ]
    },

    'SHDW-2': {
      readPaths: [
        'state',
        'vibration',
        'illuminance',
        'illuminanceLevel',
        'sensorError',
        'battery',
        'wakeupEvent',
        {
          key: 'temperature',
          converter: temperatureConverter
        },
      ]
    },

    'SHWT-1': {
      readPaths: [
        'flood',
        'sensorError',
        'battery',
        'wakeupEvent',
        {
          key: 'temperature',
          converter: temperatureConverter
        },
      ]
    },

    'SHMOS-01': {
      readPaths: [
        'motion',
        'vibration',
        'battery',
        'illuminance'
      ]
    },

    'SHMOS-02': {
      readPaths: [
        {
          key: 'motion',
          notification: {
            handler: (value) => {
              return value === 1
            },
            messageOn: 'motion detected',
            messageOff: 'motion cleared'
          }
        },
        'vibration',
        'battery',
        'illuminance',
        {
          key: 'temperature',
          converter: temperatureConverter
        },
      ]
    },
  }

  deviceTypes['SHSW-25:roller'] = { ...deviceTypes['SHSW-21:roller'] }
  deviceTypes['SHSW-25:roller'].readPaths.push('overTemperature')
  deviceTypes['SHSW-25:roller'].readPaths.push('deviceTemperature')
  deviceTypes['SHSW-25:relay'] = { ...deviceTypes['SHSW-21:relay'] }
  deviceTypes['SHSW-25:relay'].readPaths.push('overTemperature')
  deviceTypes['SHSW-25:relay'].readPaths.push('deviceTemperature')

  deviceTypes['SH2LED-1'] = { ...deviceTypes['SHRGBWW-01'] }
  deviceTypes['SH2LED-1'].switchCount = 2

  deviceTypes['SHBLB-1:color'] = { ...deviceTypes['SHRGBWW-01'] }
  deviceTypes['SHBLB-1:white'] = { ...deviceTypes['SHRGBW2:white'] }

  deviceTypes['SHCB-1:color'] = { ...deviceTypes['SHRGBWW-01'] }
  deviceTypes['SHCB-1:white'] = { ...deviceTypes['SHRGBW2:white'] }

  deviceTypes['SHCL-255:color'] = { ...deviceTypes['SHRGBWW-01'] }
  deviceTypes['SHCL-255:white'] = { ...deviceTypes['SHRGBW2:white'] }

  deviceTypes['Shelly Pro 2'] = { ...deviceTypes['Shelly Plus 2 PM'] }
  deviceTypes['Shelly Pro 2 PM'] = { ...deviceTypes['Shelly Plus 2 PM'] }
  
  return plugin
}

interface Plugin {
  start: (app: any) => void
  stop: () => void
  id: string
  name: string
  description: string
  schema: any
  uiSchema: any
}

function boolValue (value: any) {
  return value === 1 || value === 'on' || value === 'true' || value === true
}

function boolString (value: any) {
  return boolValue(value) ? 'on' : 'off'
}

function boolFrom (value: any) {
  return value === 'on' ? 1 : 0
}
