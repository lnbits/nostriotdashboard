# Nostr IoT Dashboard - An [LNbits](https://github.com/lnbits/lnbits) Extension

## Control IoT Devices Through Nostr Protocol

The Nostr IoT Dashboard extension provides a user interface for discovering and controlling IoT devices that implement the Nostr Data Vending Machine (DVM) protocol.

## Features

- **Device Discovery**: Automatically finds IoT devices from your Nostr follow list that advertise DVM capabilities
- **Real-time Control**: Execute device capabilities through Nostr DVM requests and receive responses
- **Lightning Integration**: Seamless payment handling for premium IoT functions with QR code invoice display  
- **Multi-relay Support**: Connects to multiple Nostr relays for improved reliability
- **Flexible Authentication**: Supports both Nostr browser extensions and manual private key input

## How It Works

1. **Connect to Nostr**: Authenticate using a Nostr browser extension or private key
2. **Discover Devices**: The extension scans your follow list for IoT devices advertising DVM capabilities (kind 31990 events)
3. **Control Devices**: Click device capabilities to send DVM requests (kind 5107) and receive responses (kind 6107)
4. **Handle Payments**: For premium functions, pay Lightning invoices displayed as QR codes

## Supported Device Types

This extension works with any IoT device that implements the Nostr DVM protocol, including:
- Smart home devices (lights, switches, sensors)
- Environmental monitors  
- Industrial IoT equipment
- Custom Nostr-enabled hardware

## Technical Details

- **Nostr Event Types**: Handles kinds 3 (contact lists), 31990 (DVM advertisements), 5107 (DVM requests), and 6107 (DVM responses)
- **WebSocket Connections**: Uses nostr-tools for client side Nostr stuff

## Getting Started

1. Install the extension in your LNbits instance
2. Follow IoT device accounts on Nostr that provide DVM services
3. Open the Nostr IoT Dashboard and connect your Nostr identity
4. Discovered devices will appear automatically - click capabilities to control them
