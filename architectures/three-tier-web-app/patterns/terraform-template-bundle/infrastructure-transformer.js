/**
 * Infrastructure Transformer for CALM Three-Tier Web App Pattern
 * Transforms CALM architecture models into template variables for Terraform generation
 */

class InfrastructureTransformer {
  registerTemplateHelpers() {
    return {
      eq: (a, b) => a === b,
      json: (obj) => JSON.stringify(obj, null, 2),
    };
  }

  getTransformedModel(calmCore) {
    // calmCore is a CalmCore object, we need to convert it to JSON schema
    const calmModel = calmCore.toSchema ? calmCore.toSchema() : calmCore;
    const result = transform(calmModel);
    
    // Return document structure as expected by template system
    return {
      document: {
        // Include project-specific variables for templates
        project_name: result.variables.project_name,
        environment: result.variables.environment,
        resource_group_name: result.variables.resource_group_name,
        location: result.variables.location,
        
        // Include all variables for template access
        ...result.variables,
        
        // Include structured data for complex templates
        project: result.project,
        cloudProvider: result.cloudProvider,
        infrastructure: result.infrastructure
      }
    };
  }



  async copyStartupScripts() {
    try {
      // Get the template bundle directory (where this transformer is located)
      const templateBundleDir = path.dirname(new URL(import.meta.url).pathname);
      const scriptsSourceDir = path.join(templateBundleDir, 'scripts');
      
      // Determine the output directory from environment or use default
      // The CALM CLI should set this, but we'll use a fallback
      const outputDir = process.env.CALM_OUTPUT_DIR || path.join(process.cwd(), 'generated-terraform');
      const scriptsDestDir = path.join(outputDir, 'scripts');
      
      // Create scripts directory in output location
      await fs.mkdir(scriptsDestDir, { recursive: true });
      
      // Copy all .sh files from source to destination
      const scriptFiles = await fs.readdir(scriptsSourceDir);
      const shellScripts = scriptFiles.filter(file => file.endsWith('.sh'));
      
      for (const scriptFile of shellScripts) {
        const sourcePath = path.join(scriptsSourceDir, scriptFile);
        const destPath = path.join(scriptsDestDir, scriptFile);
        await fs.copyFile(sourcePath, destPath);
        console.log(`📋 Copied startup script: ${scriptFile}`);
      }
      
      console.log(`✅ Successfully copied ${shellScripts.length} startup scripts to ${scriptsDestDir}`);
    } catch (error) {
      console.warn(`⚠️  Warning: Could not copy startup scripts: ${error.message}`);
      // Don't fail the transformation if script copying fails
    }
  }
}

function transform(calmModel) {
  const result = {
    project: {},
    infrastructure: {
      webTier: {},
      appTier: {},
      dataTier: {},
      networking: {},
      loadBalancing: {},
      storage: {}
    },
    cloudProvider: detectCloudProvider(calmModel),
    variables: {}
  };

  // Extract project metadata from the metadata array
  if (calmModel.metadata && Array.isArray(calmModel.metadata)) {
    const metadataMap = {};
    calmModel.metadata.forEach(item => {
      if (item.name && item.value) {
        // Format: { name: "project-name", value: "my-project" }
        metadataMap[item.name] = item.value;
      } else {
        // Format: { "project-name": "my-project", "environment": "dev", ... }
        Object.keys(item).forEach(key => {
          metadataMap[key] = item[key];
        });
      }
    });
    
    result.project = {
      name: metadataMap['project-name'],
      environment: metadataMap['environment'],
      location: metadataMap['location'],
      resourceGroup: metadataMap['resource-group-name'],
      description: calmModel.description
    };
  } else if (calmModel.metadata && typeof calmModel.metadata === 'object') {
    // Single object format: { "project-name": "my-project", ... }
    result.project = {
      name: calmModel.metadata['project-name'],
      environment: calmModel.metadata['environment'],
      location: calmModel.metadata['location'],
      resourceGroup: calmModel.metadata['resource-group-name'],
      description: calmModel.description
    };
  }

  // Process nodes to extract infrastructure components
  if (calmModel.nodes) {
    calmModel.nodes.forEach(node => {
      processNode(node, result);
    });
  }

  // Process relationships to understand connections
  if (calmModel.relationships) {
    calmModel.relationships.forEach(relationship => {
      processRelationship(relationship, result);
    });
  }

  // Generate Terraform-specific variables
  generateTerraformVariables(result);

  return result;
}

function detectCloudProvider(calmModel) {
  // Detect cloud provider from node names/types
  if (!calmModel || !calmModel.nodes) {
    return undefined;
  }
  
  const nodeNames = calmModel.nodes.map(n => {
    const id = n['unique-id'] || n.unique_id || n.id || '';
    return typeof id === 'string' ? id.toLowerCase() : '';
  }).filter(name => name);
  
  if (nodeNames.some(name => name.includes('azure'))) {
    return 'azure';
  } else if (nodeNames.some(name => name.includes('aws'))) {
    return 'aws';
  } else if (nodeNames.some(name => name.includes('gcp') || name.includes('google'))) {
    return 'gcp';
  }
  
  return undefined;
}

function processNode(node, result) {
  if (!node) return;
  
  const nodeId = node['unique-id'] || node.unique_id || node.id;
  if (!nodeId) return;

  // Extract interface data for container images and ports
  const extractInterfaceValue = (interfaces, key) => {
    if (!Array.isArray(interfaces)) return undefined;
    const interfaceItem = interfaces.find(iface => iface[key]);
    return interfaceItem ? interfaceItem[key] : undefined;
  };

  // Extract interface data for URLs (these are typically outputs, not inputs)
  const extractUrlInterface = (interfaces) => {
    if (!Array.isArray(interfaces)) return undefined;
    const urlInterface = interfaces.find(iface => iface.url);
    return urlInterface ? {
      interfaceId: urlInterface['unique-id'],
      url: urlInterface.url === '[[ URL ]]' ? undefined : urlInterface.url // Don't use placeholder values
    } : undefined;
  };

  // Define explicit node mappings based on unique-id from the pattern
  const WEB_TIER_NODES = [
    'webtier-google-compute-engine-vms',
    'webtier-ec2-vms', 
    'webtier-azure-vms'
  ];

  const APP_TIER_NODES = [
    'google-app-server-vms',
    'aws-app-server-vms',
    'azure-app-server-vms'
  ];

  const DATABASE_NODES = [
    'google-mongodb-vm',
    'aws-mongodb-ec2',
    'azure-mongodb-vm'
  ];

  const NETWORKING_NODES = [
    'google-vpc',
    'aws-vpc', 
    'azure-vnet'
  ];

  const SUBNET_NODES = [
    'google-subnet',
    'aws-subnet',
    'azure-subnet'
  ];

  const LOAD_BALANCER_NODES = [
    'google-external-lb',
    'google-internal-lb',
    'aws-external-lb',
    'aws-internal-lb', 
    'azure-external-lb',
    'azure-internal-lb'
  ];

  const STORAGE_NODES = [
    'google-cloud-storage',
    'aws-s3',
    'azure-blob-storage'
  ];

  const NSG_NODES = [
    'web-tier-nsg',
    'app-tier-nsg', 
    'db-tier-nsg'
  ];

  const NETWORK_COMPONENT_NODES = [
    'azure-external-lb-ip',
    'azure-mongodb-vm-nic'
  ];

  // Process web tier nodes
  if (WEB_TIER_NODES.includes(nodeId)) {
    const urlInterface = extractUrlInterface(node.interfaces);
    result.infrastructure.webTier = {
      ...result.infrastructure.webTier,
      instanceCount: node.instance_count || node.properties?.instance_count,
      vmSize: node.vm_size || node.properties?.vm_size,
      port: extractInterfaceValue(node.interfaces, 'port') || node.properties?.port,
      containerImage: extractInterfaceValue(node.interfaces, 'image'),
      healthCheckPath: node.properties?.health_check_path,
      // Store URL interface info for potential output generation
      urlInterface: urlInterface,
      ...extractNodeProperties(node)
    };
  }

  // Process app tier nodes  
  if (APP_TIER_NODES.includes(nodeId)) {
    result.infrastructure.appTier = {
      ...result.infrastructure.appTier,
      instanceCount: node.instance_count || node.properties?.instance_count,
      vmSize: node.vm_size || node.properties?.vm_size,
      port: extractInterfaceValue(node.interfaces, 'port') || node.properties?.port,
      containerImage: extractInterfaceValue(node.interfaces, 'image'),
      ...extractNodeProperties(node)
    };
  }

  // Process database tier nodes
  if (DATABASE_NODES.includes(nodeId)) {
    result.infrastructure.dataTier = {
      ...result.infrastructure.dataTier,
      dbType: node.properties?.database_type,
      vmSize: node.vm_size || node.properties?.vm_size,
      port: extractInterfaceValue(node.interfaces, 'port') || node.properties?.port,
      containerImage: extractInterfaceValue(node.interfaces, 'image'),
      ...extractNodeProperties(node)
    };
  }

  // Process networking nodes (VPC/VNet)
  if (NETWORKING_NODES.includes(nodeId)) {
    result.infrastructure.networking = {
      ...result.infrastructure.networking,
      addressSpace: node.properties?.address_space,
      subnets: node.properties?.subnets,
      ...extractNodeProperties(node)
    };
  }

  // Process subnet nodes
  if (SUBNET_NODES.includes(nodeId)) {
    result.infrastructure.networking = {
      ...result.infrastructure.networking,
      addressSpace: result.infrastructure.networking.addressSpace || node.properties?.address_space,
      subnets: result.infrastructure.networking.subnets || node.properties?.subnets,
      ...extractNodeProperties(node)
    };
  }

  // Process load balancer nodes
  if (LOAD_BALANCER_NODES.includes(nodeId)) {
    const lbType = nodeId.includes('external') ? 'external' : 'internal';
    result.infrastructure.loadBalancing[lbType] = {
      ...result.infrastructure.loadBalancing[lbType],
      sku: node.properties?.sku,
      ...extractNodeProperties(node)
    };
  }

  // Process storage nodes
  if (STORAGE_NODES.includes(nodeId)) {
    result.infrastructure.storage = {
      ...result.infrastructure.storage,
      accountTier: node.properties?.account_tier,
      replicationType: node.properties?.replication_type,
      ...extractNodeProperties(node)
    };
  }

  // Process NSG nodes (these are implementation details for security)
  if (NSG_NODES.includes(nodeId)) {
    result.infrastructure.security = result.infrastructure.security || {};
    result.infrastructure.security[nodeId] = {
      nodeId: nodeId,
      tier: nodeId.replace('-tier-nsg', ''),
      ...extractNodeProperties(node)
    };
  }

  // Process network component nodes (supporting infrastructure)
  if (NETWORK_COMPONENT_NODES.includes(nodeId)) {
    result.infrastructure.networkComponents = result.infrastructure.networkComponents || {};
    result.infrastructure.networkComponents[nodeId] = {
      nodeId: nodeId,
      ...extractNodeProperties(node)
    };
  }
}

function processRelationship(relationship, result) {
  // Extract connection information and dependencies
  result.relationships = result.relationships || [];
  result.relationships.push({
    source: relationship.source,
    destination: relationship.destination,
    relationship_type: relationship.relationship_type,
    description: relationship.description
  });
}

function extractNodeProperties(node) {
  const properties = {};
  
  // Extract direct node properties (like vm_size, instance_count)
  const nodePropertyKeys = ['vm_size', 'instance_count', 'database_type', 'account_tier', 'replication_type', 'sku', 'address_space', 'subnets'];
  nodePropertyKeys.forEach(key => {
    if (node[key] !== undefined) {
      properties[key] = node[key];
    }
  });
  
  // Extract nested properties object
  if (node.properties) {
    Object.keys(node.properties).forEach(key => {
      properties[key] = node.properties[key];
    });
  }

  // Extract node metadata (can be array or object format)
  if (node.metadata) {
    if (Array.isArray(node.metadata)) {
      node.metadata.forEach(meta => {
        if (meta.name && meta.value) {
          // Format: { name: "key", value: "value" }
          properties[`metadata_${meta.name}`] = meta.value;
        } else {
          // Format: { "key": "value", ... }
          Object.keys(meta).forEach(key => {
            properties[`metadata_${key}`] = meta[key];
          });
        }
      });
    } else if (typeof node.metadata === 'object') {
      // Single object format
      Object.keys(node.metadata).forEach(key => {
        properties[`metadata_${key}`] = node.metadata[key];
      });
    }
  }

  return properties;
}

function generateTerraformVariables(result) {
  const cloudProvider = result.cloudProvider;
  
  result.variables = {
    // Project variables from CALM metadata
    project_name: result.project.name,
    environment: result.project.environment, 
    resource_group_name: result.project.resourceGroup,
    location: result.project.location,
    
    // Web tier variables
    web_vm_count: result.infrastructure.webTier.instanceCount,
    web_vm_size: result.infrastructure.webTier.vmSize,
    web_container_image: result.infrastructure.webTier.containerImage,
    web_container_port: result.infrastructure.webTier.port,
    
    // App tier variables
    app_vm_count: result.infrastructure.appTier.instanceCount,
    app_vm_size: result.infrastructure.appTier.vmSize,
    app_container_image: result.infrastructure.appTier.containerImage,
    app_container_port: result.infrastructure.appTier.port,
    
    // Database variables
    database_vm_size: result.infrastructure.dataTier.vmSize,
    database_type: result.infrastructure.dataTier.dbType,
    database_container_image: result.infrastructure.dataTier.containerImage,
    database_container_port: result.infrastructure.dataTier.port,
    
    // Networking variables
    vnet_address_space: result.infrastructure.networking.addressSpace || "10.0.0.0/16",
    
    // Add owner field that templates reference
    owner: result.project.owner,
    
    // Tags using project metadata
    common_tags: {
      Project: result.project.name,
      Environment: result.project.environment,
      ManagedBy: 'Terraform',
      CreatedFrom: 'CALM-Template'
    }
  };
}

// Export the transformer class as ES module default export  
export default InfrastructureTransformer;