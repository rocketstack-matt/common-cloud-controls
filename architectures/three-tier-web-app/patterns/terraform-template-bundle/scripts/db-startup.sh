#!/bin/bash
# Database Tier Startup Script
# This script installs Docker and runs the containerized database server

set -e

# Variables from Terraform templatefile
DATABASE_CONTAINER_IMAGE="${database_container_image}"
DATABASE_CONTAINER_PORT="${database_container_port}"
DATABASE_ROOT_PASSWORD="${database_root_password}"
DATABASE_NAME="${database_name}"

# Update system packages
apt-get update
apt-get upgrade -y

# Install Docker
apt-get install -y ca-certificates curl gnupg lsb-release
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io

# Start Docker service
systemctl enable docker
systemctl start docker

# Wait for Docker to start
sleep 10

# Create database data directory
mkdir -p /var/lib/database-data
chmod 755 /var/lib/database-data

# Pull and run the database container
echo "Starting database container: ${database_container_image}" >> /var/log/database-startup.log

# Run the database container with persistent data
docker run -d \
    --name database-container \
    --restart always \
    -p ${database_container_port}:${database_container_port} \
    -v /var/lib/database-data:/var/lib/mysql \
    -e MYSQL_ROOT_PASSWORD=${database_root_password} \
    -e MYSQL_DATABASE=${database_name} \
    -e MYSQL_USER=appuser \
    -e MYSQL_PASSWORD=${database_root_password} \
    ${database_container_image}

# Wait for database to start and initialize
sleep 30

# Check if container is running
if docker ps | grep -q database-container; then
    echo "✅ Database container started successfully" >> /var/log/database-startup.log
    echo "Container ID: $(docker ps --filter name=database-container --format '{{.ID}}')" >> /var/log/database-startup.log
else
    echo "❌ Failed to start database container" >> /var/log/database-startup.log
    echo "Docker logs:" >> /var/log/database-startup.log
    docker logs database-container >> /var/log/database-startup.log 2>&1
    exit 1
fi

# Test database connectivity
echo "Testing database connectivity..." >> /var/log/database-startup.log
for i in {1..30}; do
    if docker exec database-container mysqladmin ping -h localhost --silent; then
        echo "✅ Database is responding" >> /var/log/database-startup.log
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Database failed to respond after 30 attempts" >> /var/log/database-startup.log
        exit 1
    fi
    sleep 2
done

# Install and configure database health check script
cat > /usr/local/bin/database-health-check.sh << 'EOF'
#!/bin/bash
# Check if database container is running and responding
if ! docker ps | grep -q database-container; then
    echo "Database container not running"
    exit 1
fi

# Check if database is responding
docker exec database-container mysqladmin ping -h localhost --silent
if [ $? -eq 0 ]; then
    echo "Database health check passed"
    exit 0
else
    echo "Database health check failed"
    exit 1
fi
EOF

chmod +x /usr/local/bin/database-health-check.sh

# Set up cron job for health checks
echo "*/2 * * * * /usr/local/bin/database-health-check.sh >> /var/log/database-health.log 2>&1" | crontab -

# Configure log rotation for database logs
cat > /etc/logrotate.d/database-logs << EOF
/var/log/database-*.log {
    daily
    compress
    copytruncate
    delaycompress
    missingok
    notifempty
    rotate 30
}
EOF

# Create a simple status page
mkdir -p /var/www/html
cat > /var/www/html/database-status.html << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Database Tier Status</title>
</head>
<body>
    <h1>Database Tier - Running</h1>
    <p>Container Image: ${database_container_image}</p>
    <p>Container Port: ${database_container_port}</p>
    <p>Database Name: ${database_name}</p>
    <p>Timestamp: \$(date)</p>
    <p>Hostname: \$(hostname)</p>
    <p>Docker Status: \$(docker ps --format "table {{.Image}}\t{{.Status}}" | grep database-container)</p>
    <p>Database Status: \$(docker exec database-container mysqladmin ping -h localhost --silent && echo "Healthy" || echo "Unhealthy")</p>
</body>
</html>
EOF

# Set up database backup script
cat > /usr/local/bin/database-backup.sh << 'BACKUP_SCRIPT'
#!/bin/bash
# Daily database backup
BACKUP_DIR="/var/lib/database-backups"
mkdir -p $${BACKUP_DIR}
BACKUP_FILE="$${BACKUP_DIR}/backup_$(date +%Y%m%d_%H%M%S).sql"
docker exec database-container mysqldump -u root -p${database_root_password} ${database_name} > $${BACKUP_FILE}
if [ $? -eq 0 ]; then
    echo "Database backup completed: $${BACKUP_FILE}" >> /var/log/database-startup.log
    # Keep only last 7 days of backups
    find $${BACKUP_DIR} -name "backup_*.sql" -mtime +7 -delete
else
    echo "Database backup failed" >> /var/log/database-startup.log
fi
BACKUP_SCRIPT

chmod +x /usr/local/bin/database-backup.sh

# Schedule daily backups at 2 AM
echo "0 2 * * * /usr/local/bin/database-backup.sh >> /var/log/database-backup.log 2>&1" | crontab -

# Set up monitoring and logging
apt-get install -y rsyslog
systemctl enable rsyslog
systemctl start rsyslog

# Create startup completion marker
touch /var/log/database-startup-complete

echo "Database tier startup completed successfully" >> /var/log/database-startup.log
echo "Container ${database_container_image} running on port ${database_container_port}" >> /var/log/database-startup.log
echo "Database ${database_name} initialized and ready for connections" >> /var/log/database-startup.log