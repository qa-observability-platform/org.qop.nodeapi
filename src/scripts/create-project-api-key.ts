// src/scripts/create-project-api-key.ts
import { findProjectByKey } from '../repositories/projects.repository.js';
import { createApiKey } from '../repositories/projectApiKeys.repository.js';

/**
 * Script to create a project API key from command line
 * Usage: npm run create-api-key -- --orgId=<org-id> --projectKey=<project-key> --label=<label>
 */
async function main() {
  const args = process.argv.slice(2);
  const params: Record<string, string> = {};

  args.forEach((arg) => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      params[key] = value;
    }
  });

  const { orgId, projectKey, label } = params;

  if (!orgId || !projectKey || !label) {
    console.error('❌ Usage: npm run create-api-key -- --orgId=<org-id> --projectKey=<project-key> --label=<label>');
    process.exit(1);
  }

  try {
    console.log('🔍 Finding project...');
    const project = await findProjectByKey(orgId, projectKey);

    if (!project) {
      console.error(`❌ Project not found: ${orgId}/${projectKey}`);
      process.exit(1);
    }

    console.log(`✅ Found project: ${project.name}`);
    console.log('🔑 Generating API key...');

    const { apiKey, plainKey } = await createApiKey(project.id, label);

    console.log('\n✅ API Key created successfully!\n');
    console.log('━'.repeat(80));
    console.log(`🏷️  Label:       ${apiKey.label}`);
    console.log(`🔑 API Key:     ${plainKey}`);
    console.log(`📅 Created:     ${apiKey.createdAt}`);
    console.log('━'.repeat(80));
    console.log('\n⚠️  IMPORTANT: Save this API key now. It will not be shown again!\n');
    console.log('Add to your environment:');
    console.log(`  export QOP_API_KEY="${plainKey}"`);
    console.log(`  export QOP_PROJECT_KEY="${project.projectKey}"`);
    console.log(`  export QOP_APP_KEY="<your-app-key>"\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to create API key:', error);
    process.exit(1);
  }
}

main();