import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChakraProvider,
  VStack,
  Input,
  Box,
  Text,
  createSystem,
  defaultConfig,
} from '@chakra-ui/react';
import { ThemeProvider } from 'next-themes';

// Declare the window API type
declare global {
  interface Window {
    api: {
      listApplications: () => Promise<Array<{ name: string; path: string; }>>;
      openPath: (path: string) => Promise<{success: boolean, error?: string}>;
      searchFiles: (query: string) => Promise<Array<{ name: string; path: string; }>>;
      llmQuery: (query: string) => Promise<any>;
    }
  }
}

// Restore theme system
const system = createSystem(defaultConfig, {
  theme: {
    tokens: {
      colors: {
        // Define any custom colors here if needed
      }
    },
    semanticTokens: {
      colors: {
        // Define semantic tokens if needed
      }
    }
  }
});

function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ name: string; path: string; }>>([]);
  const [applications, setApplications] = useState<Array<{ name: string; path: string; }>>([]);

  // State for LLM text response
  const [llmResponseText, setLlmResponseText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Load applications on mount
    if (window.api) {
      console.log("Attempting listApplications...");
      window.api.listApplications().then(setApplications).catch(console.error);
    } else {
      console.error("Initial load failed: window.api not defined.");
    }
  }, []);

  // Function to handle LLM query submission
  const handleLlmSubmit = useCallback(async () => {
    if (!searchQuery || !window.api) {
      return; // Don't submit if query is empty or api not ready
    }

    console.log(`[App.tsx] Submitting LLM query: "${searchQuery}"`);
    setIsLoading(true);
    setLlmResponseText(null); // Clear previous text response
    setSearchResults([]);     // Clear previous search results

    try {
      const result = await window.api.llmQuery(searchQuery);
      console.log('[App.tsx] LLM Query Result:', result);

      // --- Handle LLM Response --- 
      if (result.type === 'tool_executed') {
        const searchCall = result.results?.find((r: any) => r.call.function.name === 'searchFiles');
        if (searchCall && searchCall.result) {
          console.log('[App.tsx] Setting search results from tool call.');
          setSearchResults(searchCall.result);
        }
        const listCall = result.results?.find((r: any) => r.call.function.name === 'listApplications');
        if (listCall && listCall.result) {
          console.log('[App.tsx] Setting application results from tool call.');
          setApplications(listCall.result); // Update apps if LLM lists them
        }
        // Handle other tools like openPath if needed (e.g., clear input)
        // If a tool was executed, we generally don't show a text response alongside it
        setLlmResponseText(null);

      } else if (result.type === 'text_response') {
        setLlmResponseText(result.content);
        setSearchResults([]); // Clear file search results if LLM gave text response
      } else if (result.type === 'error') {
        console.error('[App.tsx] LLM Query Error:', result.error);
        setLlmResponseText(`Error: ${result.error}`); // Show error as text
        setSearchResults([]);
      }
      // --- End Handle LLM Response ---

    } catch (err) {
      console.error('[App.tsx] Error calling llmQuery:', err);
      setLlmResponseText(`IPC Error: ${(err as Error).message}`);
      setSearchResults([]);
    } finally {
      setIsLoading(false); // Stop loading indicator
    }
  }, [searchQuery]);

  const handleItemClick = async (path: string) => {
    if (window.api) {
      try {
        const result = await window.api.openPath(path);
        if (!result.success) {
          console.error('Main process failed to open path:', result.error);
          // TODO: Show error to user
        }
      } catch (error) {
        console.error("Failed to open path:", error);
        // TODO: Show error to user
      }
    } else {
      console.error('window.api not defined for click!');
    }
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  // Handle Enter key press in Input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent default form submission/newline
      handleLlmSubmit();
    }
  };

  return (
    <ChakraProvider value={system}>
      <ThemeProvider attribute="class" disableTransitionOnChange>
        <VStack gap={4} p={4}>
          <Input
            placeholder="Ask or search..."
            value={searchQuery}
            onChange={handleSearch}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          
          {isLoading && <Text p={2} color="gray.500">Thinking...</Text>}

          {llmResponseText ? (
            <Box 
              w="100%" 
              p={3} 
              bg="gray.100"
              color="gray.800"
              _dark={{
                bg: "gray.700",
                color: "whiteAlpha.900"
              }}
              borderRadius="md" 
              boxShadow="sm"
            >
              <Text whiteSpace="pre-wrap">{llmResponseText}</Text>
            </Box>
          ) : searchResults.length > 0 ? (
            <VStack w="100%" align="stretch" gap={1} mt={4}> 
              {searchResults.map((result, index) => (
                <Box
                  key={index}
                  p={2}
                  cursor="pointer"
                  _hover={{ bg: 'gray.100' }}
                  onClick={() => handleItemClick(result.path)}
                >
                  <Text>{result.name}</Text>
                  <Text fontSize="sm" color="gray.500">{result.path}</Text>
                </Box>
              ))}
            </VStack>
          ) : !searchQuery && !isLoading ? (
            <VStack w="100%" align="stretch" gap={1}> 
              {applications.map((app, index) => (
                <Box
                  key={index}
                  p={2}
                  cursor="pointer"
                  _hover={{ bg: 'gray.100' }}
                  onClick={() => handleItemClick(app.path)}
                >
                  <Text>{app.name}</Text>
                </Box>
              ))}
            </VStack>
          ) : null}

        </VStack>
      </ThemeProvider>
    </ChakraProvider>
  );
}

export default App; 