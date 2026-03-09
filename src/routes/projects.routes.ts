// src/routes/projects.routes.ts
import type { Express } from 'express';
import {
  createProject,
  findProjectByKey,
  listProjectsByOrg,
  updateProject,
  deleteProject,
  isProjectKeyAvailable,
} from '../repositories/projects.repository.js';
import {
  createApiKey,
  listApiKeysByProject,
  revokeApiKey,
} from '../repositories/projectApiKeys.repository.js';
import { config } from '../config/env.js';
import { authenticate } from '../middleware/auth.middleware.js';

export function registerProjectsRoutes(app: Express) {
  app.get('/organizations/:orgId/projects', authenticate, async (req, res) => {
    try {
      const { orgId } = req.params;
      const projects = await listProjectsByOrg(orgId);
      res.json({ projects });
    } catch (error) {
      console.error('Failed to list projects:', error);
      res.status(500).json({ error: 'Failed to list projects' });
    }
  });

  app.post('/organizations/:orgId/projects', authenticate, async (req, res) => {
    try {
      const { orgId } = req.params;
      const { projectKey, name, description, repoUrl, defaultBranch } = req.body;

      if (!projectKey || !name) {
        return res.status(400).json({ error: 'projectKey and name are required' });
      }
      if (!/^[a-z0-9-]+$/.test(projectKey)) {
        return res.status(400).json({
          error: 'projectKey must contain only lowercase letters, numbers, and hyphens',
        });
      }
      const available = await isProjectKeyAvailable(orgId, projectKey);
      if (!available) {
        return res.status(409).json({ error: 'projectKey already exists' });
      }
      const project = await createProject({ orgId, projectKey, name, description, repoUrl, defaultBranch });
      res.status(201).json({ project });
    } catch (error) {
      console.error('Failed to create project:', error);
      res.status(500).json({ error: 'Failed to create project' });
    }
  });

  app.get('/organizations/:orgId/projects/:projectKey', authenticate, async (req, res) => {
    try {
      const { orgId, projectKey } = req.params;
      const project = await findProjectByKey(orgId, projectKey);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.json({ project });
    } catch (error) {
      console.error('Failed to get project:', error);
      res.status(500).json({ error: 'Failed to get project' });
    }
  });

  app.put('/organizations/:orgId/projects/:projectKey', authenticate, async (req, res) => {
    try {
      const { orgId, projectKey } = req.params;
      const { name, description, repoUrl, defaultBranch } = req.body;
      const existing = await findProjectByKey(orgId, projectKey);
      if (!existing) return res.status(404).json({ error: 'Project not found' });
      const project = await updateProject(existing.id, { name, description, repoUrl, defaultBranch });
      res.json({ project });
    } catch (error) {
      console.error('Failed to update project:', error);
      res.status(500).json({ error: 'Failed to update project' });
    }
  });

  app.delete('/organizations/:orgId/projects/:projectKey', authenticate, async (req, res) => {
    try {
      const { orgId, projectKey } = req.params;
      const existing = await findProjectByKey(orgId, projectKey);
      if (!existing) return res.status(404).json({ error: 'Project not found' });
      await deleteProject(existing.id);
      res.status(204).send();
    } catch (error) {
      console.error('Failed to delete project:', error);
      res.status(500).json({ error: 'Failed to delete project' });
    }
  });

  app.get('/organizations/:orgId/projects/:projectKey/api-keys', authenticate, async (req, res) => {
    try {
      const { orgId, projectKey } = req.params;
      const project = await findProjectByKey(orgId, projectKey);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const apiKeys = await listApiKeysByProject(project.id);
      res.json({ apiKeys });
    } catch (error) {
      console.error('Failed to list API keys:', error);
      res.status(500).json({ error: 'Failed to list API keys' });
    }
  });

  app.post('/organizations/:orgId/projects/:projectKey/api-keys', authenticate, async (req, res) => {
    try {
      const { orgId, projectKey } = req.params;
      const { label } = req.body;
      if (!label) return res.status(400).json({ error: 'label is required' });
      const project = await findProjectByKey(orgId, projectKey);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const { apiKey, plainKey } = await createApiKey(project.id, label, {
        wsEndpoint: config.wsEndpoint,
        apiBaseUrl: config.apiBaseUrl,
      });
      res.status(201).json({ apiKey, plainKey });
    } catch (error) {
      console.error('Failed to create API key:', error);
      res.status(500).json({ error: 'Failed to create API key' });
    }
  });

  app.delete('/api-keys/:keyId', authenticate, async (req, res) => {
    try {
      const { keyId } = req.params;
      const success = await revokeApiKey(keyId);
      if (!success) return res.status(404).json({ error: 'API key not found or already revoked' });
      res.status(204).send();
    } catch (error) {
      console.error('Failed to revoke API key:', error);
      res.status(500).json({ error: 'Failed to revoke API key' });
    }
  });
}
