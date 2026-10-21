FROM docker.io/library/php:8.4-fpm-alpine

RUN apk add --no-cache git unzip
COPY --from=docker.io/library/composer:2 /usr/bin/composer /usr/local/bin/composer

WORKDIR /var/www/html
