import { Router } from 'express';
import type { IFoundryRepository } from '../repository/index.js';
import type { ArtifactType, ActivityEvent } from '../repository/types.js';

export function buildTasksRouter(repo: IFoundryRepository): Router {
  const router = Router();

  // GET /api/tasks?projectId=
  router.get('/', (req, res) => {
    try {
      const { projectId } = req.query as Record<string, string | undefined>;
      if (!projectId) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }
      const tasks = repo.tasks.listForProject(projectId);
      const artifactLookup = {
        getByTaskOutput: (tid: string, name: string) =>
          repo.artifacts.getByTaskOutput(tid, name),
      };
      const tasksWithState = tasks.map((task) => ({
        ...task,
        state: repo.tasks.deriveState(task, artifactLookup),
      }));
      res.json(tasksWithState);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/tasks/:id
  router.get('/:id', (req, res) => {
    try {
      const task = repo.tasks.get(req.params['id']!);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      const artifactLookup = {
        getByTaskOutput: (tid: string, name: string) =>
          repo.artifacts.getByTaskOutput(tid, name),
      };
      const state = repo.tasks.deriveState(task, artifactLookup);
      res.json({ ...task, state });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/tasks/:id/complete  — founder task completion
  router.post('/:id/complete', (req, res) => {
    try {
      const task = repo.tasks.get(req.params['id']!);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      if (task.agent !== 'founder') {
        res.status(400).json({ error: 'Only founder tasks can be completed via this endpoint' });
        return;
      }

      const body = req.body as {
        outputName?: string;
        content?: string;
        type?: string;
        metadata?: Record<string, unknown>;
      };

      const { outputName, content, type, metadata } = body;

      if (!outputName || content === undefined || !type) {
        res.status(400).json({ error: 'outputName, content, and type are required' });
        return;
      }

      // Verify outputName is declared
      const declaredOutput = task.outputs.find((o) => o.name === outputName);
      if (!declaredOutput) {
        res.status(400).json({
          error: `Output '${outputName}' is not declared in task outputs. Declared: ${task.outputs.map((o) => o.name).join(', ')}`,
        });
        return;
      }

      // Verify type matches
      if (declaredOutput.type !== type) {
        res.status(400).json({
          error: `Type mismatch for output '${outputName}': declared '${declaredOutput.type}', got '${type}'`,
        });
        return;
      }

      const storeArgs: Parameters<typeof repo.artifacts.store>[0] = {
        projectId: task.projectId,
        taskId: task.id,
        outputName,
        type: type as ArtifactType,
        name: outputName,
        content,
        createdBy: 'founder',
      };
      if (metadata !== undefined) {
        storeArgs.metadata = metadata;
      }
      const artifact = repo.artifacts.store(storeArgs);

      repo.activity.append(
        task.projectId,
        'artifact-created' as ActivityEvent,
        { taskId: task.id, outputName, artifactId: artifact.id, agent: 'founder' },
      );

      res.status(201).json({ artifact_id: artifact.id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
