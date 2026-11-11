FROM node:20-alpine
WORKDIR /app
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev
COPY . .
ENV PORT=80 DATA_DIR=/data
EXPOSE 80
CMD ["node", "server/server.js"]
