#!/usr/bin/env node
/**
 * Generate project tree structure for com.qop.nodeapi
 * Run: node generate-tree.js
 */

const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  'allure-results',
  'allure-report',
  'test-results',
]);

const IGNORE_FILES = new Set([
  '.DS_Store',
  'package-lock.json',
  'npm-debug.log',
  'yarn.lock',
  '.env.local',
  '.env.development.local',
  '.env.test.local',
  '.env.production.local',
]);

function generateTree(dir, prefix = '', isLast = true, maxDepth = 10, currentDepth = 0) {
  if (currentDepth >= maxDepth) return '';

  const items = fs.readdirSync(dir).filter(item => {
    return !IGNORE_DIRS.has(item) && !IGNORE_FILES.has(item);
  });

  let output = '';

  items.forEach((item, index) => {
    const itemPath = path.join(dir, item);
    const isLastItem = index === items.length - 1;
    const connector = isLastItem ? '└── ' : '├── ';
    const stats = fs.statSync(itemPath);

    output += `${prefix}${connector}${item}\n`;

    if (stats.isDirectory()) {
      const newPrefix = prefix + (isLastItem ? '    ' : '│   ');
      output += generateTree(itemPath, newPrefix, isLastItem, maxDepth, currentDepth + 1);
    }
  });

  return output;
}

function main() {
  const rootDir = __dirname;
  const projectName = 'com.qop.nodeapi';

  console.log('\n' + '='.repeat(60));
  console.log(`📦 ${projectName} - Project Structure`);
  console.log('='.repeat(60) + '\n');

  console.log(projectName + '/');
  const tree = generateTree(rootDir, '', true, 10, 0);
  console.log(tree);

  // Save to file
  const outputFile = path.join(rootDir, 'PROJECT_TREE.txt');
  const content = `${projectName}/\n${tree}`;
  fs.writeFileSync(outputFile, content, 'utf8');

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Tree saved to: ${outputFile}`);
  console.log('='.repeat(60) + '\n');
}

main();
