# Use Node.js base image
FROM node:18

# Install Bluetooth dependencies
RUN apt-get update && \
    apt-get install -y libbluetooth-dev bluetooth bluez libudev-dev && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app
COPY . .

# Expose the app port (default Express port is 3000)
EXPOSE 3000

# Run your app
CMD ["npm", "start"]
