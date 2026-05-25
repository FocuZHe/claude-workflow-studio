const TaskQueueModel = require('../models/TaskQueue');
const TaskModel = require('../models/Task');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * TaskQueue business logic service
 */
class TaskQueueService {
  /** @type {import('./BroadcastService')|null} */
  static _broadcastService = null;

  /** @type {import('./TaskService')|null} */
  static _taskService = null;

  /**
   * Initialize TaskQueueService with dependencies
   * @param {import('./BroadcastService')} broadcastService
   * @param {import('./TaskService')} taskService
   */
  static init(broadcastService, taskService) {
    TaskQueueService._broadcastService = broadcastService;
    TaskQueueService._taskService = taskService;
  }

  /**
   * Create a new task queue
   */
  static create(data) {
    if (!data.name) {
      throw new AppError('VALIDATION_ERROR', 'name is required', 400);
    }
    if (!data.workflowId) {
      throw new AppError('VALIDATION_ERROR', 'workflowId is required', 400);
    }
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'items must be a non-empty array', 400);
    }

    const queue = TaskQueueModel.create(data);
    logger.info(`Task queue created: ${queue.id}`, { name: queue.name, itemCount: queue.items.length });
    return queue;
  }

  /**
   * List queues
   */
  static list(filters) {
    return TaskQueueModel.findAll(filters);
  }

  /**
   * Get queue by ID
   */
  static getById(id) {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Task queue with id '${id}' not found`, 404);
    }
    return queue;
  }

  /**
   * Update queue metadata
   */
  static update(id, data) {
    const result = TaskQueueModel.update(id, data);
    if (!result) {
      throw new AppError('NOT_FOUND', `Task queue with id '${id}' not found`, 404);
    }
    if (result.error) {
      throw new AppError('VALIDATION_ERROR', result.error, 400);
    }
    logger.info(`Task queue updated: ${id}`);
    return result;
  }

  /**
   * Delete queue
   */
  static delete(id) {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Task queue with id '${id}' not found`, 404);
    }
    if (queue.status === 'running') {
      throw new AppError('CONFLICT', '不能删除正在运行的队列', 409);
    }

    TaskQueueModel.delete(id);
    logger.info(`Task queue deleted: ${id}`);
    return true;
  }

  /**
   * Start executing the queue
   */
  static async start(id) {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Task queue with id '${id}' not found`, 404);
    }

    if (!TaskQueueModel.isValidTransition(queue.status, 'running')) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Cannot start queue in '${queue.status}' status`,
        400
      );
    }

    const updated = TaskQueueModel.update(id, { status: 'running' });
    if (updated.error) {
      throw new AppError('VALIDATION_ERROR', updated.error, 400);
    }

    logger.info(`Task queue started: ${id}`);
    TaskQueueService._broadcastQueueUpdate(id, 'queue.started', { queue: updated });

    // Begin processing the first item
    TaskQueueService._processCurrentItem(id).catch(err => {
      logger.error(`Queue processing error: ${id}`, { error: err.message });
    });

    return { status: 'running' };
  }

  /**
   * Pause the queue
   */
  static pause(id) {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Task queue with id '${id}' not found`, 404);
    }

    if (!TaskQueueModel.isValidTransition(queue.status, 'paused')) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Cannot pause queue in '${queue.status}' status`,
        400
      );
    }

    const updated = TaskQueueModel.update(id, { status: 'paused' });
    if (updated.error) {
      throw new AppError('VALIDATION_ERROR', updated.error, 400);
    }

    logger.info(`Task queue paused: ${id}`);
    TaskQueueService._broadcastQueueUpdate(id, 'queue.paused', { queue: updated });
    return { status: 'paused' };
  }

  /**
   * Resume the queue
   */
  static resume(id) {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Task queue with id '${id}' not found`, 404);
    }

    if (queue.status !== 'paused') {
      throw new AppError(
        'VALIDATION_ERROR',
        `Cannot resume queue in '${queue.status}' status`,
        400
      );
    }

    const updated = TaskQueueModel.update(id, { status: 'running' });
    if (updated.error) {
      throw new AppError('VALIDATION_ERROR', updated.error, 400);
    }

    logger.info(`Task queue resumed: ${id}`);
    TaskQueueService._broadcastQueueUpdate(id, 'queue.resumed', { queue: updated });

    // Continue processing
    TaskQueueService._processCurrentItem(id).catch(err => {
      logger.error(`Queue processing error after resume: ${id}`, { error: err.message });
    });

    return { status: 'running' };
  }

  /**
   * Cancel the queue
   */
  static cancel(id) {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Task queue with id '${id}' not found`, 404);
    }

    if (!TaskQueueModel.isValidTransition(queue.status, 'cancelled')) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Cannot cancel queue in '${queue.status}' status`,
        400
      );
    }

    // Cancel any currently running item
    const currentItem = TaskQueueModel.getCurrentItem(id);
    if (currentItem && currentItem.status === 'running' && currentItem.taskId) {
      try {
        TaskQueueService._taskService.cancel(currentItem.taskId);
      } catch (e) {
        logger.warn(`Failed to cancel current task ${currentItem.taskId}: ${e.message}`);
      }
      TaskQueueModel.updateItemStatus(id, currentItem.id, 'cancelled');
    }

    // Cancel all pending items
    const q = TaskQueueModel.findById(id);
    if (q) {
      for (const item of q.items) {
        if (item.status === 'pending' || item.status === 'waiting_human') {
          TaskQueueModel.updateItemStatus(id, item.id, 'cancelled');
        }
      }
    }

    const updated = TaskQueueModel.update(id, { status: 'cancelled' });
    if (updated.error) {
      throw new AppError('VALIDATION_ERROR', updated.error, 400);
    }

    logger.info(`Task queue cancelled: ${id}`);
    TaskQueueService._broadcastQueueUpdate(id, 'queue.cancelled', { queue: updated });
    return { status: 'cancelled' };
  }

  /**
   * Add an item to the queue
   */
  static addItem(queueId, itemData) {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Task queue with id '${queueId}' not found`, 404);
    }

    const newItem = {
      id: require('../utils/id').generateId(),
      input: itemData.input || '',
      position: itemData.position !== undefined ? itemData.position : queue.items.length,
      status: 'pending',
      taskId: null,
      output: null,
      error: null,
      waitingHumanType: null,
      waitingNodeId: null,
      startedAt: null,
      completedAt: null
    };

    const items = [...queue.items, newItem];
    // Re-sort by position
    items.sort((a, b) => a.position - b.position);
    // Update positions to be sequential
    items.forEach((item, idx) => { item.position = idx; });

    TaskQueueModel.update(queueId, { items });
    logger.info(`Item added to queue ${queueId}: ${newItem.id}`);
    TaskQueueService._broadcastQueueUpdate(queueId, 'queue.itemAdded', { item: newItem });
    return newItem;
  }

  /**
   * Remove an item from the queue
   */
  static removeItem(queueId, itemId) {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Task queue with id '${queueId}' not found`, 404);
    }

    const item = queue.items.find(i => i.id === itemId);
    if (!item) {
      throw new AppError('NOT_FOUND', `Item with id '${itemId}' not found in queue`, 404);
    }

    if (item.status === 'running') {
      throw new AppError('CONFLICT', '不能移除正在运行的项目', 409);
    }

    const items = queue.items.filter(i => i.id !== itemId);
    // Re-sort and re-index
    items.sort((a, b) => a.position - b.position);
    items.forEach((it, idx) => { it.position = idx; });

    // Adjust currentItemIndex if needed
    let currentItemIndex = queue.currentItemIndex;
    const removedIndex = queue.items.findIndex(i => i.id === itemId);
    if (removedIndex < currentItemIndex) {
      currentItemIndex = Math.max(0, currentItemIndex - 1);
    }

    TaskQueueModel.update(queueId, { items, currentItemIndex });
    logger.info(`Item removed from queue ${queueId}: ${itemId}`);
    TaskQueueService._broadcastQueueUpdate(queueId, 'queue.itemRemoved', { itemId });
    return true;
  }

  /**
   * Reorder an item within the queue
   */
  static reorderItem(queueId, itemId, newPosition) {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Task queue with id '${queueId}' not found`, 404);
    }

    const item = queue.items.find(i => i.id === itemId);
    if (!item) {
      throw new AppError('NOT_FOUND', `Item with id '${itemId}' not found in queue`, 404);
    }

    if (item.status === 'running') {
      throw new AppError('CONFLICT', '不能重排正在运行的项目', 409);
    }

    const items = [...queue.items];
    const oldIndex = items.findIndex(i => i.id === itemId);
    const [moved] = items.splice(oldIndex, 1);
    items.splice(newPosition, 0, moved);
    items.forEach((it, idx) => { it.position = idx; });

    TaskQueueModel.update(queueId, { items });
    logger.info(`Item reordered in queue ${queueId}: ${itemId} to position ${newPosition}`);
    TaskQueueService._broadcastQueueUpdate(queueId, 'queue.itemReordered', { itemId, newPosition });
    return items.map(i => ({ ...i }));
  }

  /**
   * Process the current item in the queue
   * @private
   */
  static async _processCurrentItem(queueId) {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) return;

    // Only process if queue is running
    if (queue.status !== 'running') return;

    // Find the next pending item starting from currentItemIndex
    const nextItem = TaskQueueModel.getNextPendingItem(queueId);
    if (!nextItem) {
      // No more items - mark queue as completed
      TaskQueueModel.update(queueId, { status: 'completed' });
      logger.info(`Task queue completed: ${queueId}`);
      TaskQueueService._broadcastQueueUpdate(queueId, 'queue.completed', {
        queue: TaskQueueModel.findById(queueId)
      });
      return;
    }

    const itemIndex = nextItem._index;
    const item = nextItem;

    // Update currentItemIndex to this item's position
    TaskQueueModel.update(queueId, { currentItemIndex: itemIndex });

    // Mark item as running
    TaskQueueModel.updateItemStatus(queueId, item.id, 'running');
    TaskQueueService._broadcastQueueUpdate(queueId, 'queue.itemStarted', {
      item: TaskQueueModel.findById(queueId).items[itemIndex]
    });

    try {
      // Create a Task for this item
      const task = TaskModel.create({
        title: `Queue ${queue.name} - Item ${itemIndex + 1}`,
        description: `Auto-generated task for queue ${queueId}, item ${item.id}`,
        workflowId: queue.workflowId,
        input: item.input,
        queueId: queueId,
        queueItemId: item.id
      });

      // Store taskId on the item
      TaskQueueModel.updateItemStatus(queueId, item.id, 'running', { taskId: task.id });

      // Execute the task via TaskService
      await TaskQueueService._taskService.execute(task.id);

    } catch (err) {
      logger.error(`Failed to process queue item ${item.id}: ${err.message}`);
      try {
        TaskQueueService._onTaskFail(queueId, item.id, null, err.message);
      } catch (e) { /* queue may have been deleted */ }
    }
  }

  /**
   * Called when a task associated with a queue item completes
   * @private
   */
  static _onTaskComplete(queueId, itemId, taskId, output) {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) return;

    // Update item status to completed
    TaskQueueModel.updateItemStatus(queueId, itemId, 'completed', { output });

    // Increment completed count
    TaskQueueModel.update(queueId, {
      completedCount: queue.completedCount + 1
    });

    logger.info(`Queue item completed: ${itemId} in queue ${queueId}`);
    TaskQueueService._broadcastQueueUpdate(queueId, 'queue.itemCompleted', {
      itemId,
      taskId,
      output
    });

    // Advance to next item
    TaskQueueService._advanceToNext(queueId);
  }

  /**
   * Called when a task associated with a queue item fails
   * @private
   */
  static _onTaskFail(queueId, itemId, taskId, error) {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) return;

    // Update item status to failed
    TaskQueueModel.updateItemStatus(queueId, itemId, 'failed', { error });

    // Increment failed count
    TaskQueueModel.update(queueId, {
      failedCount: queue.failedCount + 1
    });

    logger.warn(`Queue item failed: ${itemId} in queue ${queueId}`, { error });
    TaskQueueService._broadcastQueueUpdate(queueId, 'queue.itemFailed', {
      itemId,
      taskId,
      error
    });

    if (queue.autoStopOnError) {
      // Stop the queue on error
      TaskQueueModel.update(queueId, { status: 'failed' });
      logger.warn(`Task queue failed (autoStopOnError): ${queueId}`);
      TaskQueueService._broadcastQueueUpdate(queueId, 'queue.failed', {
        queue: TaskQueueModel.findById(queueId)
      });
    } else {
      // Advance to next item
      TaskQueueService._advanceToNext(queueId);
    }
  }

  /**
   * Advance to the next item in the queue
   * @private
   */
  static _advanceToNext(queueId) {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) return;

    // Only continue if queue is running
    if (queue.status !== 'running') return;

    // Move to the next item
    const nextIndex = queue.currentItemIndex + 1;
    if (nextIndex >= queue.items.length) {
      // No more items - mark queue as completed
      TaskQueueModel.update(queueId, { status: 'completed' });
      logger.info(`Task queue completed: ${queueId}`);
      TaskQueueService._broadcastQueueUpdate(queueId, 'queue.completed', {
        queue: TaskQueueModel.findById(queueId)
      });
      return;
    }

    TaskQueueModel.update(queueId, { currentItemIndex: nextIndex });

    // Process the next item
    TaskQueueService._processCurrentItem(queueId).catch(err => {
      logger.error(`Queue processing error during advance: ${queueId}`, { error: err.message });
    });
  }

  /**
   * Notify the queue that a human intervention is needed (approval/input node)
   * Pauses the queue and marks the item as waiting_human
   */
  static notifyHumanIntervention(queueId, runId, nodeId, type) {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) return;

    // Find the current running item
    const currentItem = TaskQueueModel.getCurrentItem(queueId);
    if (!currentItem || currentItem.status !== 'running') return;

    // Update item to waiting_human
    TaskQueueModel.updateItemStatus(queueId, currentItem.id, 'waiting_human', {
      waitingHumanType: type,
      waitingNodeId: nodeId
    });

    // Pause the queue
    TaskQueueModel.update(queueId, { status: 'paused' });

    logger.info(`Queue paused for human intervention: ${queueId}, item: ${currentItem.id}, type: ${type}`);
    TaskQueueService._broadcastQueueUpdate(queueId, 'queue.humanIntervention', {
      itemId: currentItem.id,
      nodeId,
      type
    });
  }

  /**
   * Notify the queue that human response has been received
   * Resumes the queue and marks the item back to running
   */
  static notifyHumanResponse(queueId, workflowId, nodeId) {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) return;

    // Find the item waiting for human input
    const waitingItem = queue.items.find(i => i.status === 'waiting_human' && i.waitingNodeId === nodeId);
    if (!waitingItem) return;

    // Update item back to running
    TaskQueueModel.updateItemStatus(queueId, waitingItem.id, 'running', {
      waitingHumanType: null,
      waitingNodeId: null
    });

    // Resume the queue
    TaskQueueModel.update(queueId, { status: 'running' });

    logger.info(`Queue resumed after human response: ${queueId}, item: ${waitingItem.id}`);
    TaskQueueService._broadcastQueueUpdate(queueId, 'queue.humanResponse', {
      itemId: waitingItem.id,
      nodeId
    });
  }

  /**
   * Reset stuck queues on server restart.
   * Queues that were 'running' or 'paused' are marked as 'failed' since
   * their in-memory state is lost on restart.
   */
  static resetStuckQueues() {
    try {
      const allQueues = TaskQueueModel.findAll({ limit: 99999 });
      let resetCount = 0;
      for (const queue of allQueues.items) {
        if (queue.status === 'running' || queue.status === 'paused') {
          TaskQueueModel.update(queue.id, { status: 'failed' });
          resetCount++;
          logger.info(`Reset stuck queue ${queue.id} (was ${queue.status})`);
        }
      }
      if (resetCount > 0) {
        logger.info(`Reset ${resetCount} stuck queues on server startup`);
      }
    } catch (err) {
      logger.warn(`Failed to reset stuck queues: ${err.message}`);
    }
  }

  /**
   * Broadcast queue update via BroadcastService
   * @private
   */
  static _broadcastQueueUpdate(queueId, event, data) {
    if (TaskQueueService._broadcastService) {
      TaskQueueService._broadcastService.broadcast(event, {
        queueId,
        ...data
      });
    }
  }
}

module.exports = TaskQueueService;
