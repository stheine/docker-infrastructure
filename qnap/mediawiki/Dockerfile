# Upgrade:
# - new version in FROM
# - update all the extensions URLs
# - Build new version
#   docker-compose up -d --build mediawiki
# - run upgrade script
#   docker-compose exec mediawiki /usr/local/bin/php /var/www/html/maintenance/update.php

FROM mediawiki:1.39.1

RUN \
  apt-get update && \
  apt-get install -y \
    vim \
    wget

# Performance tuning via puppet
# https://www.mediawiki.org/wiki/Manual:Performance_tuning

# RUN \
#   apt-get install -y puppet

# https://dom.as/2007/01/26/mediawiki-performance-tuning/
# RUN \
#   pecl install APC



# Install Addons/Extensions

# Required for 32-bit systems (Error 500 from parsoid/ Visual Editor)
RUN \
  docker-php-ext-install bcmath

WORKDIR /addons

# https://www.mediawiki.org/wiki/Extension:ConfirmAccount
ARG CONFIRM_ACCOUNT_URL=ConfirmAccount-REL1_39-2e03690.tar.gz
RUN \
  wget https://extdist.wmflabs.org/dist/extensions/$CONFIRM_ACCOUNT_URL && \
  tar -xzf $CONFIRM_ACCOUNT_URL -C /var/www/html/extensions

# https://www.mediawiki.org/wiki/Extension:WikiCategoryTagCloud
ARG CATEGORY_CLOUD_URL=WikiCategoryTagCloud-REL1_39-0f0fef6.tar.gz
RUN \
  wget https://extdist.wmflabs.org/dist/extensions/$CATEGORY_CLOUD_URL && \
  tar -xzf $CATEGORY_CLOUD_URL -C /var/www/html/extensions

# https://www.mediawiki.org/wiki/Extension:UploadWizard
ARG UPLOAD_WIZARD_URL=UploadWizard-REL1_39-1431150.tar.gz
RUN \
  wget https://extdist.wmflabs.org/dist/extensions/$UPLOAD_WIZARD_URL && \
  tar -xzf $UPLOAD_WIZARD_URL -C /var/www/html/extensions

# Set user profile

COPY docker_container_profile /root/.profile
