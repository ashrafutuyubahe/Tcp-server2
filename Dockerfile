FROM node:18
WORKDIR /app
COPY package*.json ./
RUN apt-get update && apt-get install -y \
    bluetooth \
    bluez \
    libbluetooth-dev \
    libudev-dev \
    && rm -rf /var/lib/apt/lists/*
RUN npm install
COPY . .

EXPOSE 3000
CMD ["node","server.js"]