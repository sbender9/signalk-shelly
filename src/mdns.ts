import mdns from 'mdns-js';
import os from 'os';

import { DeviceDiscoverer, MdnsOptions } from 'shellies-ng';
import { DeviceId } from 'shellies-ng';

/**
 * The service name that Shelly devices use to advertise themselves.
 */
const SERVICE_NAME = 'shelly';

const DEFAULT_MDNS_OPTIONS: Readonly<MdnsOptions> = {
};


/**
 * A service that can discover Shelly devices using mDNS.
 */
export class MyDeviceDiscoverer extends DeviceDiscoverer {
  /**
   * A reference to the multicast-dns library.
   */
  protected browser: any = null;

  /**
   * Options for the multicast-dns library.
   */
  protected mdnsOptions: MdnsOptions;

  /**
   * @param mdnsOptions - Options for the multicast-dns library.
   */
  constructor(mdnsOptions?: MdnsOptions) {
    super();

    // store the multicast-dns options, with default values
    this.mdnsOptions = { ...DEFAULT_MDNS_OPTIONS, ...(mdnsOptions || {}) };
  }

  /**
   * Makes this service start listening for new Shelly devices.
   */
  async start() {
    if (this.browser !== null) {
      return;
    }

    this.browser = mdns.createBrowser(mdns.tcp(SERVICE_NAME)) 

    this.browser.on('ready', () => {
      this.browser.discover()
    })

    this.browser.on('update', (data) => {
      if (
        Array.isArray(data.type) &&
          data.type[0].name === SERVICE_NAME ) {
        let deviceId = data.fullname.split('.', 1)[0];
        this.handleDiscoveredDevice({
          deviceId,
          hostname: data.host,
        });
      }
    })

    /*
    this.mdns
      .on('response', (response) => this.handleResponse(response))
      .on('error', (error) => this.emit('error', error))
      .on('warning', (error) => this.emit('error', error));

    await this.waitUntilReady();
    await this.sendQuery();
    */
  }


  /**
   * Makes this service stop searching for new Shelly devices.
   */
  async stop() {
    if (this.browser === null) {
      return;
    }

    await this.destroy();

    this.browser = null;
  }

  /**
   * Destroys the mDNS instance, closing the socket.
   */
  protected destroy(): Promise<void> {
    return new Promise((resolve) => {
      resolve()
    });
  }

  /**
   * Handles mDNS response packets by parsing them and emitting `discover`
   * events.
   * @param response - The response packets.
   */
  /*
  protected handleResponse(response: mDNS.ResponsePacket) {
    let deviceId: DeviceId | null = null;

    // see if this response contains our requested service
    for (const a of response.answers) {
      if (a.type === 'PTR' && a.name === SERVICE_NAME && a.data) {
        // this is the right service
        // get the device ID
        deviceId = a.data.split('.', 1)[0];
        break;
      }
    }

    // skip this response if it doesn't contain our requested service
    if (!deviceId) {
      return;
    }

    let ipAddress: string | null = null;

    // find the device IP address among the answers
    for (const a of response.answers) {
      if (a.type === 'A') {
        ipAddress = a.data;
      }
    }

    if (ipAddress) {
      this.handleDiscoveredDevice({
        deviceId,
        hostname: ipAddress,
      });
    }
    }
    */
}
