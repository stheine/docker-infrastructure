FROM mediawiki

WORKDIR /addons

# https://www.mediawiki.org/wiki/Special:ExtensionDistributor?extdistname=ConfirmAccount&extdistversion=REL1_27
COPY ConfirmAccount-REL1_27-f156073.tar.gz /addons/
RUN tar -xzf /addons/ConfirmAccount-REL1_27-f156073.tar.gz -C /var/www/html/extensions

# https://www.mediawiki.org/wiki/Special:ExtensionDistributor?extdistname=WikiCategoryTagCloud&extdistversion=REL1_27
COPY WikiCategoryTagCloud-REL1_27-fe5b233.tar.gz /addons/
RUN tar -xzf WikiCategoryTagCloud-REL1_27-fe5b233.tar.gz -C /var/www/html/extensions

COPY docker_container_profile /root/.profile
