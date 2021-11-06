#!/usr/bin/env node

'use strict';

const _         = require('lodash');
const check     = require('check-types-2');
const ModbusRTU = require('modbus-serial');

const logger  = require('./logger.js');

const toBitfield = function(num, bits) {
  const bitString = _.padStart(num.toString(2), bits, '0');
  const bitArray  = _.split(bitString, '');
  const chunks    = _.chunk(bitArray, 4);

  return _.join(_.map(chunks, chunk => _.join(chunk, '')), ' ');
};

const convertData = function({name, dataBuffer, scaleBuffer, spec}) {
  const {enumMap, type} = spec;
  let   out;
  let   scaleExp;

  if(scaleBuffer) {
    scaleExp = scaleBuffer.readInt16BE();
  }

  switch(type) {
    case 'acc32':      out = dataBuffer.readUInt32BE(); break;
    case 'bitfield16': out = toBitfield(dataBuffer.readUInt16BE(), 16); break;
    case 'bitfield32': out = toBitfield(dataBuffer.readUInt32BE(), 32); break;
    case 'float32':    out = dataBuffer.readFloatBE(); break;
    case 'string':     out = dataBuffer.toString().replace(/[\s\0]+$/g, ''); break;
    case 'uint16':     out = dataBuffer.readUInt16BE(); break;
    case 'int16':      out = dataBuffer.readInt16BE(); break;
    case 'count':      out = dataBuffer.readInt16BE(); break;

    case 'enum16': {
      const index = dataBuffer.readUInt16BE();

      if(!enumMap) {
        logger.warn(`${name} Missing enumMap for ${type}`);
        out = index;
      } else if(enumMap[index]) {
        out = enumMap[index];
      } else {
        logger.warn(`${name} Missing enumMap[${index}] for ${type}`);
        out = index;
      }
      break;
    }

    default:
      logger.warn(`${name} Missing handling for ${type}`);
      out = dataBuffer;
      break;
  }

  if(scaleExp) {
    out *= 10 ** scaleExp;
  }

  return out;
};

class FroniusClient {
  constructor({ip, port, id, sunspec}) {
    check.assert.string(ip, 'ip not a string');
    check.assert.number(id, 'id not a number');
    check.assert.number(port, 'port not a number');
    check.assert.array(sunspec, 'sunspec not an array');

    this.ip      = ip;
    this.port    = port;
    this.id      = id;
    this.sunspec = sunspec;
  }

  async open() {
    this.client = new ModbusRTU();

    await this.client.connectTCP(this.ip, {port: this.port});
    await this.client.setID(this.id);
  }

  async close() {
    await this.client.close();

    this.client = undefined;
  }

  findSpec(name) {
    const specs = _.filter(this.sunspec, {name});

    check.assert.not.zero(specs.length, `Spec for '${name}' not found`);
    check.assert.one(specs.length, `Multiple specs for '${name}'`);

    const spec = specs[0];

    // console.log('findSpec', {name, spec});

    return spec;
  }

  async readRegister(name) {
    check.assert.object(this.client, 'open() missing');

    const dataSpec = this.findSpec(name);
    let   scaleSpec;
    let   dataOffset;
    let   dataEnd;
    let   readAddr;
    let   readLen;
    let   scaleOffset;
    let   scaleEnd;

    if(dataSpec.scale) {
      scaleSpec = this.findSpec(dataSpec.scale);

      check.assert.equal(scaleSpec.type, 'sunssf',
        `Unexpected type ${scaleSpec.type} for scale ${name}:${dataSpec.scale}`);

      if(scaleSpec.start > dataSpec.start) {
        // Data ... Scale
        readAddr    = dataSpec.start - 1;
        readLen     = scaleSpec.end - dataSpec.start + 1;

        dataOffset  = 0;
        dataEnd     = dataSpec.end - dataSpec.start + 1;
        scaleOffset = (scaleSpec.start - dataSpec.start) * 2;
        scaleEnd    = (scaleSpec.end - dataSpec.start) * 2 + 1;
      } else {
        // Scale ... Data
        readAddr    = scaleSpec.start - 1;
        readLen     = dataSpec.end - scaleSpec.start + 1;

        dataOffset  = (dataSpec.start - scaleSpec.start) * 2;
        dataEnd     = (dataSpec.end - scaleSpec.start) * 2 + 1;
        scaleOffset = 0;
        scaleEnd    = scaleSpec.end - scaleSpec.start + 1;
      }

      // console.log({
      //   name,
      //   readAddr,
      //   readLen,
      //   dataOffset,
      //   dataEnd,
      //   scaleOffset,
      //   scaleEnd,
      // });
    } else {
      readAddr   = dataSpec.start - 1;
      readLen    = dataSpec.end - dataSpec.start + 1;

      dataOffset = 0;
      dataEnd    = readLen * 2;

      // console.log({dataStart: dataSpec.start, dataEnd: dataSpec.end, readAddr, readEnd});
    }

    const registerData = await this.client.readHoldingRegisters(readAddr, readLen);

    // console.log('readHoldingRegister', {readAddr, readLen, dataEnd, registerData});

    const dataBuffer  = registerData.buffer.slice(dataOffset, dataEnd + 1);
    const scaleBuffer = dataSpec.scale ? registerData.buffer.slice(scaleOffset, scaleEnd + 1) : null;

    // console.log({dataBuffer, scaleBuffer, registerData});

    const value = convertData({name, dataBuffer, scaleBuffer, spec: dataSpec});

    if(dataSpec.expect) {
      check.assert.equal(value, dataSpec.expect,
        `Mismatch ${dataSpec.name}, expected '${dataSpec.expect}', received '${value}'`);
    }

    if(Buffer.isBuffer(value)) {
      logger.info(`${dataSpec.name} ${dataSpec.type}`, value);
    }

    return value;
  }

  async writeRegister(name, values) {
    check.assert.object(this.client, 'open() missing');

    const specs = _.filter(this.sunspec, {name});

    check.assert.not.zero(specs.length, `Spec for '${name}' not found`);
    check.assert.one(specs.length, `Multiple specs for '${name}'`);

    const spec = specs[0];

    const addr = spec.start - 1;
    const len  = spec.end - spec.start + 1;

    check.assert.array(values, 'values not an array');
    check.assert.equal(values.length, len, `values.length mismatch (is: ${values.length}, expect: ${len})`);

    await this.client.writeRegisters(addr, values);

    const value = await this.readRegister(name);

    return value;
  }
}

module.exports = FroniusClient;
