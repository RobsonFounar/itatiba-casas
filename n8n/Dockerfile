FROM docker.io/n8nio/n8n:2.38.5

USER root
COPY entrypoint.sh /render-entrypoint.sh
RUN chmod +x /render-entrypoint.sh
USER node

ENTRYPOINT ["tini", "--", "/render-entrypoint.sh"]
