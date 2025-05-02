const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { Client } = require('@stomp/stompjs');
const SockJS = require('sockjs-client');

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = new Server(server);


// Configure PostgreSQL connection
const pool = new Pool({
  connectionString: 'postgresql://stoneproofdb_user:ijOfAUPNMogj7YCsFpmcnqUgkHgG7FXG@dpg-d009jevgi27c73b2a7vg-a.oregon-postgres.render.com/stoneproofdb',
  ssl: { rejectUnauthorized: false }, // important for Render.com
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

// Function to initialize DB and create table if not exists
async function initializeDatabase() {
  try {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS sensor_data (
        id SERIAL PRIMARY KEY,
        device_id TEXT,
        device_type TEXT,
        heart_rate INTEGER,
        boxing_hand TEXT,
        boxing_punch_type TEXT,
        boxing_power INTEGER,
        boxing_speed INTEGER,
        cadence_wheel INTEGER,
        sos_alert BOOLEAN,
        battery INTEGER,
        steps INTEGER,
        calories INTEGER,
        temperature FLOAT,
        oxygen FLOAT,
        last_updated TIMESTAMP
      )
    `;
    await pool.query(createTableQuery);
    console.log("✅ sensor_data table is ready.");
  } catch (err) {
    console.error("❌ Error creating sensor_data table:", err);
  }
}

// Function to save sensorData into database
async function saveToDatabase() {
  try {
    const query = `
      INSERT INTO sensor_data (
        device_id, device_type, heart_rate, boxing_hand, boxing_punch_type,
        boxing_power, boxing_speed, cadence_wheel, sos_alert, battery,
        steps, calories, temperature, oxygen, last_updated
      )
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
    console.error('❌ Error saving data to PostgreSQL:', err);
  }
}

// Function to update sensorData based on type
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

// Function to decode punch type
function getPunchType(hand) {
  const punchType = (hand >> 1) & 0x03;
  return punchType === 0 ? 'Straight' : punchType === 1 ? 'Swing' : punchType === 2 ? 'Upcut' : 'Unknown';
}

// REST API to accept BLE data manually
app.post("/api/sensor/ble", async (req, res) => {
  try {
    const bleData = req.body;
    sensorData = {
      ...sensorData,
      ...bleData,
      lastUpdated: new Date().toISOString(),
    };
    await saveToDatabase();
    io.emit("sensorData", sensorData);
    res.status(200).send("Data received");
  } catch (err) {
    console.error("❌ Error processing BLE data:", err);
    res.status(500).send("Server error");
  }
});

// Connect to Java microservice WebSocket
const socket = new SockJS('http://ec2-51-21-254-242.eu-north-1.compute.amazonaws.com/');

const stompClient = new Client({
  webSocketFactory: () => socket,
  reconnectDelay: 5000,
  debug: (str) => {
    console.log('STOMP Debug:', str);
  },
});

stompClient.onConnect = () => {
  console.log('✅ Connected to Java microservice WebSocket');
  stompClient.subscribe('/topic/hub900', async (message) => {
    const { type, data } = JSON.parse(message.body);
    updateSensorData(type, data);
    await saveToDatabase();
    io.emit('sensorData', sensorData);
  });
};

stompClient.onStompError = (frame) => {
  console.error('❌ STOMP Error:', frame);
};

stompClient.onWebSocketError = (error) => {
  console.error('❌ WebSocket Error:', error);
};

stompClient.activate();

// Socket.IO for real-time client updates
io.on('connection', (socket) => {
  console.log('⚡ Client connected via Socket.IO');
  socket.emit('sensorData', sensorData);

  socket.on('disconnect', () => {
    console.log('⚡ Client disconnected');
  });
});

// Start server after DB initialized
const PORT = process.env.PORT||3000 ;
console.log(PORT)
initializeDatabase().then(() => {
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

});
