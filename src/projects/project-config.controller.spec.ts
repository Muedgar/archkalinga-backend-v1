import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard, ProjectPermissionGuard } from 'src/auth/guards';
import { REQUIRE_PROJECT_PERMISSION_KEY } from 'src/auth/decorators/require-project-permission.decorator';
import { WorkspaceGuard } from 'src/workspaces/guards/workspace.guard';
import { ResponseInterceptor } from 'src/common/interceptors/response.interceptor';
import { ProjectConfigController } from './project-config.controller';
import { ProjectConfigService } from './project-config.service';

describe('GET /projects/:projectId/config', () => {
  let app: INestApplication;
  const projectId = '0ba9fdbf-cd72-4f97-82f2-fb2d988aaac8';
  const projectRepo = { findOne: jest.fn() };
  const configRepos = Array.from({ length: 5 }, () => ({ find: jest.fn() }));
  const permissionGuard = { canActivate: jest.fn(() => true) };

  beforeAll(async () => {
    const service = new ProjectConfigService(
      projectRepo as any,
      configRepos[0] as any,
      configRepos[1] as any,
      configRepos[2] as any,
      configRepos[3] as any,
      configRepos[4] as any,
      {} as any,
    );
    const module = await Test.createTestingModule({
      controllers: [ProjectConfigController],
      providers: [{ provide: ProjectConfigService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectPermissionGuard)
      .useValue(permissionGuard)
      .compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    permissionGuard.canActivate.mockReturnValue(true);
    projectRepo.findOne.mockResolvedValue({ id: projectId });
    configRepos.forEach((repo, index) =>
      repo.find.mockResolvedValue([
        { id: `config-${index}`, projectId, name: `Option ${index}`, pkid: 99 },
      ]),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns all five serialized lists scoped to the requested project', async () => {
    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/config`)
      .expect(200);
    expect(Object.keys(response.body.data)).toEqual([
      'statuses',
      'priorities',
      'severities',
      'taskTypes',
      'labels',
    ]);
    for (const list of Object.values(response.body.data) as any[][]) {
      expect(list[0]).toMatchObject({ projectId });
      expect(list[0]).not.toHaveProperty('pkid');
    }
    configRepos.forEach((repo) =>
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId } }),
      ),
    );
  });

  it('rejects malformed project IDs before querying config', async () => {
    await request(app.getHttpServer())
      .get('/projects/not-a-uuid/config')
      .expect(400);
    configRepos.forEach((repo) => expect(repo.find).not.toHaveBeenCalled());
  });

  it('returns 404 for a missing project', async () => {
    projectRepo.findOne.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/config`)
      .expect(404);
    configRepos.forEach((repo) => expect(repo.find).not.toHaveBeenCalled());
  });

  it('requires config view permission and honors a guard denial', async () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PROJECT_PERMISSION_KEY,
        ProjectConfigController.prototype.getConfig,
      ),
    ).toEqual({ domain: 'projectConfigManagement', action: 'view' });
    permissionGuard.canActivate.mockReturnValue(false);
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/config`)
      .expect(403);
    expect(projectRepo.findOne).not.toHaveBeenCalled();
  });
});
