import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import { GetUser } from 'src/auth/decorators';
import { JwtAuthGuard } from 'src/auth/guards';
import type { RequestUser } from 'src/auth/types';
import { ResponseMessage } from 'src/common/decorators';
import { GetWorkspaceMember } from 'src/workspaces/decorators/get-workspace-member.decorator';
import type { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import { WorkspaceGuard } from 'src/workspaces/guards/workspace.guard';
import {
  SearchQueryDto,
  SEARCH_RESULT_TYPES,
} from './dtos';
import type { SearchResultType } from './dtos';
import { SearchResponseSerializer } from './serializers';
import { SearchService } from './search.service';

class RecordRecentSearchDto {
  @IsIn(SEARCH_RESULT_TYPES)
  type: SearchResultType;

  @IsUUID()
  id: string;
}

@ApiTags('Search')
@ApiBearerAuth()
@Controller('search')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Search workspace commands and navigable resources',
    description:
      'MVP returns project results scoped to projects where the caller is an active member. ' +
      'Project matches include project title/description, task or subtask title, project members, and task assignees.',
  })
  @ApiResponse({ status: 200, type: SearchResponseSerializer })
  @ResponseMessage('Search results fetched')
  search(
    @Query() dto: SearchQueryDto,
    @GetUser() user: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.searchService.search(dto, user, member);
  }

  @Get('suggestions')
  @ApiOperation({ summary: 'Get command search suggestions' })
  @ApiResponse({ status: 200, type: SearchResponseSerializer })
  @ResponseMessage('Search suggestions fetched')
  suggestions(
    @Query() dto: SearchQueryDto,
    @GetUser() user: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.searchService.suggestions(dto, user, member);
  }

  @Get('recent')
  @ApiOperation({ summary: 'Get recently opened search results' })
  @ApiResponse({ status: 200, type: SearchResponseSerializer })
  @ResponseMessage('Recent search results fetched')
  recent(
    @Query() dto: SearchQueryDto,
    @GetUser() user: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.searchService.recent(dto, user, member);
  }

  @Post('recent')
  @ApiOperation({ summary: 'Record a clicked search result as recent' })
  @ApiBody({ type: RecordRecentSearchDto })
  @ResponseMessage('Recent search result recorded')
  recordRecent(
    @Body() dto: RecordRecentSearchDto,
    @GetUser() user: RequestUser,
    @GetWorkspaceMember() member: WorkspaceMember,
  ) {
    return this.searchService.recordRecent(dto.type, dto.id, user, member);
  }
}
