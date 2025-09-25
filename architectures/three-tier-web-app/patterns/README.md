# Three-Tier Web Application CALM Pattern

This document provides an overview of the Common Architecture Language Model (CALM) and explains how it's used in this reference architecture. It also provides instructions for generating a concrete architecture from the provided CALM pattern using the CALM CLI.

## 🚀 Terraform Code Generation

This pattern includes a **Terraform Template Bundle** that can generate Infrastructure as Code (IaC) from your CALM architecture models.

### Required Metadata for Terraform Generation

When creating or customizing architectures from this pattern, you **must** provide the following metadata values for successful Terraform code generation:

#### 📋 Required Metadata Fields

| Field | Placeholder | Description | Example Values |
|-------|-------------|-------------|----------------|
| `project-name` | `[[ PROJECT_NAME ]]` | Name of your project (used for resource naming) | `my-webapp`, `ecommerce-platform` |
| `environment` | `[[ ENVIRONMENT ]]` | Environment type | `dev`, `staging`, `prod` |
| `location` | `[[ CLOUD_REGION ]]` | Cloud region for deployment | Azure: `eastus`, `westus2`<br>AWS: `us-east-1`, `us-west-2`<br>GCP: `us-central1`, `europe-west1` |
| `resource-group-name` | `[[ RESOURCE_GROUP_NAME ]]` | Cloud resource group/project name | `rg-mywebapp-prod`, `my-project-123` |

#### ✏️ How to Fill In Metadata

Replace the placeholders in your architecture JSON file:

```json
{
  "metadata": [
    {
      "name": "project-name",
      "value": "my-webapp",
      "description": "Name of the project (used for resource naming)"
    },
    {
      "name": "environment", 
      "value": "prod",
      "description": "Environment (dev, staging, prod)"
    },
    {
      "name": "location",
      "value": "eastus",
      "description": "Cloud region for deployment"
    },
    {
      "name": "resource-group-name",
      "value": "rg-mywebapp-prod", 
      "description": "Cloud resource group/project name"
    }
  ]
}
```

### 🔧 Generating Terraform Code

Once you've filled in the metadata, generate Terraform code with:

```bash
npx calm template \
  --architecture ./azure.json \
  --bundle ./terraform-template-bundle \
  --output ./generated-terraform
```

This will create:
- `main.tf` - Infrastructure resources
- `variables.tf` - Parameterized inputs  
- `outputs.tf` - Resource outputs

### 📁 Template Bundle Structure

The `terraform-template-bundle/` directory contains:
- **Templates**: Handlebars templates for Terraform files
- **Transformer**: JavaScript logic to extract data from CALM models
- **Multi-cloud Support**: Azure, AWS, and GCP configurations

### 🚀 Running the Generated Terraform

After generating your Terraform files, follow these steps to deploy your infrastructure:

#### Prerequisites

1. **Install Terraform**: Download from [terraform.io](https://www.terraform.io/downloads)
2. **Cloud CLI**: Install the appropriate cloud provider CLI:
   - **Azure**: [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli)
   - **AWS**: [AWS CLI](https://aws.amazon.com/cli/)
   - **GCP**: [gcloud CLI](https://cloud.google.com/sdk/docs/install)

#### Authentication

**For Azure:**
```bash
az login
az account set --subscription "your-subscription-id"
```

**For AWS:**
```bash
aws configure
# Enter your Access Key ID, Secret Access Key, and region
```

**For GCP:**
```bash
gcloud auth login
gcloud config set project your-project-id
```

#### SSH Key Setup (Required for VMs)

Generate an SSH key pair for VM access:

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/terraform-key
```

#### Deployment Steps

1. **Navigate to the generated directory**:
   ```bash
   cd generated-terraform
   ```

2. **Initialize Terraform**:
   ```bash
   terraform init
   ```

3. **Review the plan**:
   ```bash
   terraform plan
   ```

4. **Apply the configuration**:
   ```bash
   terraform apply
   ```

5. **Access your application**:
   After deployment, Terraform will output the application URL and other connection details.

#### Cleanup

To destroy the infrastructure when no longer needed:

```bash
terraform destroy
```

#### Common Variables to Customize

You can customize the deployment by modifying `variables.tf` or creating a `terraform.tfvars` file:

```hcl
# terraform.tfvars
project_name = "my-webapp"
environment = "dev"
web_vm_count = 3
app_vm_count = 2
web_vm_size = "Standard_B1s"
app_vm_size = "Standard_B2s"
database_vm_size = "Standard_D2s_v3"
ssh_public_key_path = "~/.ssh/terraform-key.pub"
```

## What is CALM?

**CALM** (Common Architecture Language Model) is a declarative, JSON-based modeling language for describing complex systems. It allows you to define the components of an architecture (nodes), the relationships between them, and the data flows that traverse the system.

Key features of CALM include:

- **Declarative and Versioned**: Architectures are defined in a declarative format and versioned using JSON Schema.
- **Component-Based**: Systems are modeled as a collection of nodes, relationships, and flows.
- **Extensible**: CALM can be extended with custom metadata to enrich the architectural model.

## Opinionated Reference Architecture

This project provides a CALM implementation of the Common Cloud Controls Three Tier Reference Architecture.

The pattern allows you to generate a concrete architecture for one of the following Cloud Service Providers (CSPs):

- Google Cloud
- Amazon Web Services (AWS)
- Microsoft Azure

The CALM CLI will then generate the CSP specific implementation.

## Generating an Architecture from the Pattern

To generate a concrete architecture from the CALM pattern, you can use the CALM CLI. The CLI provides a `generate` command that takes the pattern file as input and allows you to select from the available options.

### Prerequisites

Before you can generate an architecture, you need to have the CALM CLI installed. You can install it using npm:

```bash
npm install -g @finos/calm-cli
```

### Generating the Architecture

To generate the architecture, run the following command from the root of this directory:

```bash
calm generate \
  --pattern ./three-tier-web-app.pattern.json \
  --output ./three-tier-web-app.architecture.json 
```

This command will prompt you to select a CSP. 

![CLI Input](./img/cli-input.png)

Once you've made your selection, the CLI will generate a `three-tier-web-app.architecture.json` file in the same directory. This file represents the concrete architecture for the selected CSP.

Loading the architecture to [CALM Hub](https://github.com/finos/architecture-as-code/tree/main/calm-hub) allows you to visualise the architectures.

#### Google Cloud
![Google Cloud](./img/google.png)

#### Amazon Web Services
![AWS](./img/aws.png)

#### Microsoft Azure
![Azure](./img/azure.png)

### Where Next?
#### Controls
This example still needs to be linked to the `control requirements` which is how CALM enables architects to tie in non-functional requirements such as security and observability.

This could be done in a 'ligh-touch' mode where we could simply reference the CCC controls in their current form or we could create CCC specific schemas which would more tightly integrate into the CALM exosystem.

#### Automation
CALM provides the foundation for being able to build out ever more automation based on it's high fidelity architecture descriptions.

One of the extensions we've discussed but yet to be implemented, would be to provide 'skeleton' code for opinionated architectures that would enable users to bookstrap their entire application and infrastrcutre code from the architecture documents.