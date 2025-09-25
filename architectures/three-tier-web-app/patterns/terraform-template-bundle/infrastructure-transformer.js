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
        metadataMap[item.name] = item.value;
      }
    });
    
    result.project = {
      name: metadataMap['project-name'],
      environment: metadataMap['environment'],
      location: metadataMap['location'],
      resourceGroup: metadataMap['resource-group-name'],
      description: calmModel.description
    };
  } else {
    // Fallback for legacy metadata format
    result.project = {
      name: calmModel.metadata?.find(m => m.name === 'project-name')?.value,
      environment: calmModel.metadata?.find(m => m.name === 'environment')?.value,
      location: calmModel.metadata?.find(m => m.name === 'location')?.value,
      resourceGroup: calmModel.metadata?.find(m => m.name === 'resource-group-name')?.value,
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
  
  const nodeId = (node['unique-id'] || node.unique_id || node.id || '').toString().toLowerCase();
  const nodeType = node['node-type'] || node.node_type || node.type || '';

  // Extract interface data for container images and ports
  const extractInterfaceValue = (interfaces, key) => {
    if (!Array.isArray(interfaces)) return undefined;
    const interfaceItem = interfaces.find(iface => iface[key]);
    return interfaceItem ? interfaceItem[key] : undefined;
  };

  // Process web tier nodes
  if (nodeId.includes('web') || nodeType === 'web-server') {
    result.infrastructure.webTier = {
      ...result.infrastructure.webTier,
      instanceCount: node.instance_count || node.properties?.instance_count,
      vmSize: node.vm_size || node.properties?.vm_size,
      port: extractInterfaceValue(node.interfaces, 'port') || node.properties?.port,
      containerImage: extractInterfaceValue(node.interfaces, 'image'),
      healthCheckPath: node.properties?.health_check_path,
      ...extractNodeProperties(node)
    };
  }

  // Process app tier nodes  
  if (nodeId.includes('app') || nodeType === 'application-server') {
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
  if (nodeId.includes('database') || nodeId.includes('mongodb') || nodeType === 'database') {
    result.infrastructure.dataTier = {
      ...result.infrastructure.dataTier,
      dbType: node.properties?.database_type,
      vmSize: node.vm_size || node.properties?.vm_size,
      port: extractInterfaceValue(node.interfaces, 'port') || node.properties?.port,
      containerImage: extractInterfaceValue(node.interfaces, 'image'),
      ...extractNodeProperties(node)
    };
  }

  // Process networking nodes
  if (nodeId.includes('vnet') || nodeId.includes('vpc') || nodeType === 'network') {
    result.infrastructure.networking = {
      ...result.infrastructure.networking,
      addressSpace: node.properties?.address_space,
      subnets: node.properties?.subnets,
      ...extractNodeProperties(node)
    };
  }

  // Process load balancer nodes
  if (nodeId.includes('loadbalancer') || nodeId.includes('lb') || nodeType === 'load-balancer') {
    const lbType = nodeId.includes('external') ? 'external' : 'internal';
    result.infrastructure.loadBalancing[lbType] = {
      ...result.infrastructure.loadBalancing[lbType],
      sku: node.properties?.sku,
      ...extractNodeProperties(node)
    };
  }

  // Process storage nodes
  if (nodeId.includes('storage') || nodeId.includes('blob') || nodeType === 'storage') {
    result.infrastructure.storage = {
      ...result.infrastructure.storage,
      accountTier: node.properties?.account_tier,
      replicationType: node.properties?.replication_type,
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
  
  if (node.properties) {
    Object.keys(node.properties).forEach(key => {
      properties[key] = node.properties[key];
    });
  }

  if (node.metadata) {
    node.metadata.forEach(meta => {
      properties[`metadata_${meta.name}`] = meta.value;
    });
  }

  return properties;
}

function generateTerraformVariables(result) {
  const cloudProvider = result.cloudProvider || 'azure';
  
  result.variables = {
    // Project variables from CALM metadata
    project_name: result.project.name || 'calm-demo',
    environment: result.project.environment || 'demo', 
    resource_group_name: result.project.resourceGroup || 'demo-rg',
    location: result.project.location || getDefaultLocation(cloudProvider),
    
    // Web tier variables with defaults
    web_vm_count: result.infrastructure.webTier.instanceCount || 2,
    web_vm_size: result.infrastructure.webTier.vmSize || getDefaultVmSize(cloudProvider, 'web'),
    web_container_image: result.infrastructure.webTier.containerImage || 'nginx:latest',
    web_container_port: result.infrastructure.webTier.port || 8080,
    
    // App tier variables with defaults
    app_vm_count: result.infrastructure.appTier.instanceCount || 2,
    app_vm_size: result.infrastructure.appTier.vmSize || getDefaultVmSize(cloudProvider, 'app'),
    app_container_image: result.infrastructure.appTier.containerImage || 'finos/calm-hub:latest',
    app_container_port: result.infrastructure.appTier.port || 8080,
    
    // Database variables with defaults
    database_vm_size: result.infrastructure.dataTier.vmSize || getDefaultVmSize(cloudProvider, 'database'),
    database_type: result.infrastructure.dataTier.dbType || 'MongoDB',
    database_container_image: result.infrastructure.dataTier.containerImage || 'mongo:latest',
    database_container_port: result.infrastructure.dataTier.port || 27017,
    
    // Networking variables with defaults
    vnet_address_space: result.infrastructure.networking.addressSpace || '10.0.0.0/16',
    
    // Add owner field that templates reference
    owner: result.project.owner || 'CALM-Generated',
    
    // Tags using real project metadata
    common_tags: {
      Project: result.project.name || 'calm-demo',
      Environment: result.project.environment || 'demo',
      ManagedBy: 'Terraform',
      CreatedFrom: 'CALM-Template'
    }
  };
}

function getDefaultLocation(provider) {
  const defaults = {
    azure: 'East US',
    aws: 'us-east-1', 
    gcp: 'us-central1'
  };
  return defaults[provider] || defaults.azure;
}

function getDefaultVmSize(provider, tier) {
  // Updated defaults to match the pattern file const values
  const defaults = {
    azure: {
      web: 'Standard_B2s',      // matches webtier-azure-vms in pattern
      app: 'Standard_B2ms',     // matches azure-app-server-vms in pattern
      database: 'Standard_B2s'  // matches azure-mongodb-vm in pattern
    },
    aws: {
      web: 't3.medium',         // matches webtier-ec2-vms in pattern
      app: 't3.large',          // matches aws-app-server-vms in pattern
      database: 't3.medium'     // matches aws-mongodb-ec2 in pattern
    },
    gcp: {
      web: 'e2-standard-2',     // matches webtier-google-compute-engine-vms in pattern
      app: 'e2-standard-4',     // matches google-app-server-vms in pattern
      database: 'e2-standard-2' // matches google-mongodb-vm in pattern
    }
  };
  return defaults[provider]?.[tier] || defaults.azure[tier];
}

// Export the transformer class as ES module default export  
export default InfrastructureTransformer;