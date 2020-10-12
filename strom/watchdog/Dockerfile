FROM arm32v6/node:14-alpine

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

# RUN sed -i 's/nameserver.*$/nameserver 8.8.8.8/' /etc/resolv.conf
# RUN \
#   sed 's/nameserver.*$/nameserver 8.8.8.8/' /etc/resolv.conf > /etc/resolv.conf.tmp && \
#   mv /etc/resolv.conf /etc/resolv.conf.weg && \
#   mv /etc/resolv.conf.tmp > /etc/resolv.conf
# RUN echo "$(sed 's/nameserver.*$/nameserver 8.8.8.8/' /etc/resolv.conf)" > /etc/resolv.conf 
RUN \
  apk update && \
  apk add \
    bash \
    ca-certificates \
    tzdata \
    vim \
    wget && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  apk del tzdata
                                                                                                          
ENV LANG en_US.UTF-8                                                                                      
ENV LANGUAGE en_US.UTF-8                                                                                  
ENV LC_ALL en_US.UTF-8                                                                                    
ENV TZ Europe/Berlin                                                                                      
                                                                                                          
# ##############################################################################                          
# Install and run strom app                                                                               
                                                                                                          
WORKDIR /root                                                                                             
                                                                                                          
COPY docker_container_profile /root/.profile                                                              
COPY vimrc .vimrc                                                                                         
RUN \                                                                                                     
  apk add \                                                                                               
    curl \                                                                                                
    git \                                                                                                 
    g++ \                                                                                                 
    linux-headers \                                                                                       
    make \                                                                                                
    python                                                                                                
                                                                                                          
# ##############################################################################
# Install and run strom app

WORKDIR /app

# CMD ["/usr/bin/tail", "-f", "/dev/null"]
CMD ["/usr/local/bin/node", "/app/watchdog.js"]
# CMD ["/bin/bash", "-l"]
