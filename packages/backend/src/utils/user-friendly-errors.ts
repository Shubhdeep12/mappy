/**
 * User-Friendly Error Messages
 * 
 * Maps technical errors to messages users can understand and act on.
 */

export interface UserFriendlyError {
  message: string;
  suggestion?: string;
  retryable: boolean;
}

export function getUserFriendlyError(error: unknown): UserFriendlyError {
  const errorStr = String(error);

  // API Rate Limits
  if (errorStr.includes('429') || errorStr.includes('quota') || errorStr.includes('rate limit')) {
    return {
      message: 'Daily request limit reached',
      suggestion: 'Please try again tomorrow, or contact support for increased limits',
      retryable: false,
    };
  }

  // Service Unavailable
  if (errorStr.includes('503') || errorStr.includes('overloaded') || errorStr.includes('UNAVAILABLE')) {
    return {
      message: 'AI service is temporarily busy',
      suggestion: 'Please wait a moment and try again',
      retryable: true,
    };
  }

  // Timeout Errors
  if (errorStr.includes('timeout') || errorStr.includes('ETIMEDOUT') || errorStr.includes('ECONNREFUSED')) {
    return {
      message: 'Request timed out',
      suggestion: 'Please check your internet connection and try again',
      retryable: true,
    };
  }

  // Coordinate/Location Errors
  if (errorStr.includes('coordinate') || errorStr.includes('geocod') || errorStr.includes('location')) {
    return {
      message: 'Invalid location',
      suggestion: 'Please select a valid address or place with roads and points of interest',
      retryable: false,
    };
  }

  // POI Discovery Errors
  if (errorStr.includes('No POIs') || errorStr.includes('POI discovery failed')) {
    return {
      message: 'No suitable places found in this area',
      suggestion: 'Try a different location or broader preferences (e.g., remove specific POI types)',
      retryable: false,
    };
  }

  // Route Generation Errors
  if (errorStr.includes('No valid routes') || errorStr.includes('Failed to generate route')) {
    return {
      message: 'Could not generate routes for this location',
      suggestion: 'Try adjusting your distance, adding more POI types, or selecting a different area',
      retryable: false,
    };
  }

  // Validation Errors
  if (errorStr.includes('CONNECTIVITY_FAILURE') || errorStr.includes('validation failed')) {
    return {
      message: 'Could not find a valid path between these points',
      suggestion: 'Try fewer waypoints or a different location with better road connectivity',
      retryable: false,
    };
  }

  // Distance Errors
  if (errorStr.includes('distance') && errorStr.includes('too')) {
    return {
      message: 'Requested distance not achievable in this area',
      suggestion: 'Try a shorter distance or a location with more points of interest',
      retryable: false,
    };
  }

  // JSON/Parsing Errors (LLM issues)
  if (errorStr.includes('JSON') || errorStr.includes('parse')) {
    return {
      message: 'AI response processing error',
      suggestion: 'Our intelligent fallback system will handle this. Try again if issue persists.',
      retryable: true,
    };
  }

  // API Key Errors
  if (errorStr.includes('API key') || errorStr.includes('authentication') || errorStr.includes('401')) {
    return {
      message: 'Service configuration error',
      suggestion: 'Please check your API keys in settings',
      retryable: false,
    };
  }

  // Generic Fallback
  return {
    message: 'Route generation failed',
    suggestion: 'Please try different preferences or contact support if the issue persists',
    retryable: true,
  };
}

/**
 * Format error for API response
 */
export function formatErrorResponse(error: unknown): {
  error: string;
  suggestion?: string;
  retryable: boolean;
  technical?: string;
} {
  const friendly = getUserFriendlyError(error);
  const technicalDetails = error instanceof Error ? error.message : String(error);

  return {
    error: friendly.message,
    suggestion: friendly.suggestion,
    retryable: friendly.retryable,
    technical: process.env.NODE_ENV === 'development' ? technicalDetails : undefined,
  };
}
