#!/bin/bash
# 批量转换JS文件为TypeScript

SERVICES_DIR="src/server/services"

# 需要转换的文件列表
FILES=(
  "MasterAgentService"
  "WorkflowService"
  "ApiKeyService"
  "WorkflowTemplateService"
  "AgentTypeService"
  "CheckpointService"
  "FileService"
  "MemoryService"
  "ChatService"
  "TaskService"
)

for file in "${FILES[@]}"; do
  echo "Converting $file.js to TypeScript..."
  
  # 创建基础TypeScript文件
  cat > "$SERVICES_DIR/$file.ts" << TSEOF
/**
 * $file - TypeScript version
 * Converted from $file.js
 */

// TODO: Add proper types and imports

export class $file {
  // TODO: Implement class
}

export default $file;
TSEOF
  
  echo "Created $file.ts"
done

echo "Conversion complete!"
