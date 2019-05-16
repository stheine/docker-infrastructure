FROM mediawiki:1.32

RUN \
  apt-get update && \
  apt-get install -y wget

WORKDIR /addons

# https://www.mediawiki.org/wiki/Special:ExtensionDistributor?extdistname=ConfirmAccount
RUN \
  wget https://extdist.wmflabs.org/dist/extensions/ConfirmAccount-REL1_32-0ccceb9.tar.gz && \
  tar -xzf ConfirmAccount-REL1_32-0ccceb9.tar.gz -C /var/www/html/extensions

# https://www.mediawiki.org/wiki/Special:ExtensionDistributor?extdistname=WikiCategoryTagCloud
RUN \
  wget https://extdist.wmflabs.org/dist/extensions/WikiCategoryTagCloud-REL1_32-2f7aa5c.tar.gz && \
  tar -xzf WikiCategoryTagCloud-REL1_32-2f7aa5c.tar.gz -C /var/www/html/extensions

COPY docker_container_profile /root/.profile
