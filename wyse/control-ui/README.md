```
cd ~/docker/control-ui/app/ && \
git pull && \
cd ../../ && \
docker compose exec control-ui npm install && \
docker compose exec control-ui npm run build
```
