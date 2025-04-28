const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { Client } = require('@stomp/stompjs'); // Correct import
const SockJS = require('sockjs-client');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 4000;
// Configure PostgreSQL connection
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'fitness',
  password: 'aine',
  port: 5432,
});

// Sensor data object
let sensorData = {
  deviceId: null,
  deviceType: null,
  heartRate: null,
  boxingHand: null,
  boxingPunchType: null,
  boxingPower: null,
  boxingSpeed: null,
  cadenceWheel: null,
  sosAlert: false,
  battery: null,
  steps: null,
  calories: null,
  temperature: null,
  oxygen: null,
  lastUpdated: null,
};

app.use(express.json());

// REST API to fetch latest sensor data
app.get('/api/sensor', (req, res) => {
  res.json(sensorData);
});

// Connect to Java microservice WebSocket
const socket = new SockJS('http://localhost:9000');
const stompClient = new Client({
  webSocketFactory: () => socket,
  reconnectDelay: 5000, // Auto-reconnect every 5 seconds if disconnected
  debug: (str) => {
    console.log('STOMP Debug:', str); // Optional: for debugging
  },
});

stompClient.onConnect = () => {
  console.log('Connected to Java microservice WebSocket');
  stompClient.subscribe('/topic/hub900', async (message) => {
    const { type, data } = JSON.parse(message.body);
    updateSensorData(type, data);
    await saveToDatabase();
    io.emit('sensorData', sensorData);
  });
};

stompClient.onStompError = (frame) => {
  console.error('STOMP Error:', frame);
};

stompClient.onWebSocketError = (error) => {
  console.error('WebSocket Error:', error);
};

stompClient.activate(); // Start the STOMP client

function updateSensorData(type, data) {
  sensorData.lastUpdated = new Date();
  sensorData.deviceType = type;

  if (type === 'antHeartRate' || type === 'bleHeartRate' || type === 'bleBoxingHeartRate') {
    sensorData.heartRate = data.heartRate;
    sensorData.battery = data.battery;
    sensorData.deviceId = data.deviceId;
    if (type === 'bleHeartRate' || type === 'bleBoxingHeartRate') {
      sensorData.steps = data.steps || null;
      sensorData.calories = data.calories || null;
      sensorData.temperature = data.temperature || null;
      sensorData.oxygen = data.oxygen || null;
    }
  } else if (type === 'bleBoxing') {
    sensorData.boxingHand = data.hand === 0 ? 'Left' : 'Right';
    sensorData.boxingPunchType = getPunchType(data.hand);
    sensorData.boxingPower = data.power;
    sensorData.boxingSpeed = data.speed;
    sensorData.battery = data.battery;
    sensorData.deviceId = data.deviceId;
  } else if (type === 'bleCadence') {
    sensorData.cadenceWheel = data.wheel;
  } else if (type === 'bleSOS') {
    sensorData.sosAlert = true;
    sensorData.deviceId = data.deviceId;
  } else if (type === 'idle') {
    sensorData = { ...sensorData, lastUpdated: new Date() }; // Update timestamp only
  }
}

function getPunchType(hand) {
  const punchType = (hand >> 1) & 0x03;
  return punchType === 0 ? 'Straight' : punchType === 1 ? 'Swing' : punchType === 2 ? 'Upcut' : 'Unknown';
}

async function saveToDatabase() {
  try {
    const query = `
      INSERT INTO sensor_data (device_id, device_type, heart_rate, boxing_hand, boxing_punch_type, boxing_power, boxing_speed, cadence_wheel, sos_alert, battery, steps, calories, temperature, oxygen, last_updated)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `;
    const values = [
      sensorData.deviceId,
      sensorData.deviceType,
      sensorData.heartRate,
      sensorData.boxingHand,
      sensorData.boxingPunchType,
      sensorData.boxingPower,
      sensorData.boxingSpeed,
      sensorData.cadenceWheel,
      sensorData.sosAlert,
      sensorData.battery,
      sensorData.steps,
      sensorData.calories,
      sensorData.temperature,
      sensorData.oxygen,
      sensorData.lastUpdated,
    ];
    await pool.query(query, values);
  } catch (err) {
    console.error('Error saving data to PostgreSQL:', err);
  }
}

io.on('connection', (socket) => {
  console.log('Client connected via Socket.IO');
  socket.emit('sensorData', sensorData);
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});
// server.js
app.post("/api/sensor/ble", async (req, res) => {
  try {
    const bleData = req.body;
    // Update sensorData
    sensorData = {
      ...sensorData,
      ...bleData,
      lastUpdated: new Date().toISOString(),
    };
    // Save to PostgreSQL
    await saveToDatabase();
    // Broadcast to Socket.IO clients (ProfileScreen, UserDetailScreen)
    io.emit("sensorData", sensorData);
    res.status(200).send("Data received");
  } catch (err) {
    console.error("Error processing BLE data:", err);
    res.status(500).send("Server error");
  }
});

server.listen(PORT, () => {
  console.log(`Node.js API server listening at http://localhost:${PORT}`);
});