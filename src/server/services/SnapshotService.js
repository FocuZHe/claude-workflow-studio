const fs = require('fs');
const path = require('path');
const { generateId } = require('../utils/id');
const logger = require('../utils/logger');
const { atomicWriteSync } = require('../utils/atomicWrite');

class SnapshotService {
  static _baseDir = null;

  static init(workspaceRoot) {
    SnapshotService._baseDir = path.join(workspaceRoot, 'WORKFLOWS', 'snapshots');
    if (!fs.existsSync(SnapshotService._baseDir)) {
      fs.mkdirSync(SnapshotService._baseDir, { recursive: true });
    }
  }

  static save(workflowId, name) {
    const WorkflowModel = require('../models/Workflow');
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) throw new Error('工作流未找到');

    const snapshot = {
      id: generateId(),
      workflowId,
      name: name || `快照 ${new Date().toLocaleString('zh-CN')}`,
      data: JSON.parse(JSON.stringify(workflow)),
      createdAt: new Date().toISOString()
    };

    const dir = path.join(SnapshotService._baseDir, workflowId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(path.join(dir, `${snapshot.id}.json`), JSON.stringify(snapshot, null, 2));
    return snapshot;
  }

  static list(workflowId) {
    const dir = path.join(SnapshotService._baseDir, workflowId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      return { id: data.id, name: data.name, createdAt: data.createdAt };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  static restore(workflowId, snapshotId) {
    const filePath = path.join(SnapshotService._baseDir, workflowId, `${snapshotId}.json`);
    if (!fs.existsSync(filePath)) throw new Error('Snapshot not found');
    const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const WorkflowModel = require('../models/Workflow');
    return WorkflowModel.update(workflowId, snapshot.data);
  }

  static delete(workflowId, snapshotId) {
    const filePath = path.join(SnapshotService._baseDir, workflowId, `${snapshotId}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}
module.exports = SnapshotService;
