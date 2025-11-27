#!/usr/local/bin/python

# docs:
# https://github.com/toreamun/asyncio-paho
# https://github.com/lkempf/casambi-bt
# https://www.emqx.com/en/blog/how-to-use-mqtt-in-python

import asyncio
import json
import logging
import os
import random
import re
import sys
import time

from CasambiBt import Casambi, discover
from asyncio_paho import AsyncioPahoClient

networkPassword = os.environ['CASAMBI_NETWORK_PASSWORD']
broker          = os.environ['MQTT_BROKER']
port            = int(os.environ['MQTT_PORT'])
baseTopic       = os.environ['MQTT_BASE_TOPIC']

client_id = f'casambi-mqtt-{random.randint(0, 1000)}'

FIRST_RECONNECT_DELAY = 1
RECONNECT_RATE = 2
MAX_RECONNECT_COUNT = 12
MAX_RECONNECT_DELAY = 60

# App log level
logger = logging.getLogger('casambi-mqtt')
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
# handler.setLevel(logging.DEBUG)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)

# logger = logging.getLogger('casambi-mqtt')

# CasambiBt log level
# casambiBtLogger = logging.getLogger("CasambiBt")
# casambiBtLogger.setLevel(logging.WARNING)
# casambiBtLogger.addHandler(handler)

def onDisconnect(client, userdata, rc):
  logger.info("Disconnected with result code: %s", rc)
  reconnect_count, reconnect_delay = 0, FIRST_RECONNECT_DELAY
  while reconnect_count < MAX_RECONNECT_COUNT:
    logger.info("Reconnecting in %d seconds...", reconnect_delay)
    time.sleep(reconnect_delay)

    try:
      client.reconnect()
      logger.info("Reconnected successfully!")
      return
    except Exception as err:
      logger.error("%s. Reconnect failed. Retrying...", err)

    reconnect_delay *= RECONNECT_RATE
    reconnect_delay = min(reconnect_delay, MAX_RECONNECT_DELAY)
    reconnect_count += 1

  logger.info("Reconnect failed after %s attempts. Exiting...", reconnect_count)


def find(units, name):
  for unit in units:
    if unit.name == name:
      return unit

async def main():
  casambi = None

  logging.getLogger("CasambiBt").setLevel(logging.INFO)

  # -----------------------------------------------------------------
  # MQTT connect
  async def onConnect(mqttClient, userdata, message, four):
    logger.info("Connected to MQTT Broker!")

    while casambi == None:
      await asyncio.sleep(1)

    # -----------------------------------------------------------------
    # Subscribe to MQTT messages for each of the Casambi units
    for unit in casambi.units:
      topic = f"{baseTopic}/{casambi.networkName}/{unit.name}/cmnd"

      await mqttClient.asyncio_subscribe(topic)

      logger.info(f"Subscribed to {topic}")

  mqttClient = AsyncioPahoClient(client_id=client_id)

  mqttClient.asyncio_listeners.add_on_connect(onConnect)

  await mqttClient.asyncio_connect(broker, port)

  # -----------------------------------------------------------------
  # Discover networks
  logger.debug("Searching Casambi network(s)...")
  networks = await discover()

  if len(networks) == 0:
    logger.error(f"network found")

    exit()
  elif len(networks) == 1:
    network = networks[0]
  else:
    for i, d in enumerate(networks):
      print(f"[{i}]\t{d.address}")

    selection = int(input("Select network: "))

    network = networks[selection]

  # pwd = input("Enter password: ")

  # -----------------------------------------------------------------
  # Connect to the selected network
  casambi = Casambi()

  try:
    await casambi.connect(network, networkPassword)

    logger.info(f"Connected to network: {casambi.networkName}")

    # ---------------------------------------------------------------
    # Handler for Casambi unit state change, publishing the new state to MQTT
    def unitChangedHandler(unit):
      logger.info(f"Unit change: {unit.name}, on={unit._on}, dimmer={unit._state.dimmer} vertical={unit._state.vertical} temperature={unit._state.temperature}") # TODO debug
    
      msg = {
        "on":          unit._on,
        "online":      unit._online,
        "colorsource": unit._state.colorsource,
        "dimmer":      unit._state.dimmer,
        "rgb":         unit._state.rgb,
        "slider":      unit._state.slider,
        "temperature": unit._state.temperature,
        "vertical":    unit._state.vertical,
        "white":       unit._state.white,
        "xy":          unit._state.xy,
      }
      topic = f"{baseTopic}/{casambi.networkName}/{unit.name}/state"
    
      result = mqttClient.publish(topic, json.dumps(msg), qos=0, retain=True)
    
      status = result[0]
      if status != 0:
        logger.error(f"Failed to send message to topic {topic}")

    casambi.registerUnitChangedHandler(unitChangedHandler)

    await asyncio.sleep(1)

    # -----------------------------------------------------------------
    # Handler for MQTT messages
    async def onMessageAsync(client, userdata, msg):
      logger.debug(f"Received `{msg.payload.decode()}` from `{msg.topic}` topic")

      loop = asyncio.get_running_loop()
      set = json.loads(msg.payload.decode())

      if "dimmer" in set:
        logger.info(f"{msg.topic} set dimmer={set['dimmer']}")

        reFind = re.findall(f"^casambi/{casambi.networkName}/(.*)/cmnd$", msg.topic)
        if len(reFind) == 1:
          unitName = reFind[0]
          unit = find(casambi.units, unitName)
          if unit != None:
            await casambi.setLevel(unit, set["dimmer"])

      if "temperature" in set:
        logger.info(f"{msg.topic} set temperature={set['temperature']}")

        reFind = re.findall(f"^casambi/{casambi.networkName}/(.*)/cmnd$", msg.topic)
        if len(reFind) == 1:
          unitName = reFind[0]
          unit = find(casambi.units, unitName)
          if unit != None:
            await casambi.setTemperature(unit, set["temperature"])

      if "vertical" in set:
        logger.info(f"{msg.topic} set vertical={set['vertical']}")

        reFind = re.findall(f"^casambi/{casambi.networkName}/(.*)/cmnd$", msg.topic)
        if len(reFind) == 1:
          unitName = reFind[0]
          unit = find(casambi.units, unitName)
          if unit != None:
            await casambi.setVertical(unit, set["vertical"])

    mqttClient.asyncio_listeners.add_on_message(onMessageAsync)

    # -----------------------------------------------------------------
    # Report health
    async def health():
      logger.info("Start health interval")
      while True:
        mqttClient.publish('casambi/health/STATE', 'OK', qos=0, retain=False)
        await asyncio.sleep(60)

    loop = asyncio.get_running_loop()
    loop.create_task(health())
      
    # -----------------------------------------------------------------
    # Make the app never stop
    await asyncio.Future()

  finally:
    # -----------------------------------------------------------------
    # On shutdown disconnect MQTT and Casambi network
    await casambi.disconnect()
    mqttClient.disconnect()

if __name__ == "__main__":
  asyncio.run(main())
