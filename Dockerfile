FROM node:18-alpine

# Устанавливаем инструменты для сборки бинарных модулей (нужно для sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./

# Принудительная чистая установка
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]