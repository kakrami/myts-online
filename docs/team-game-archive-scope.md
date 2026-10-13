# Team-game decisions and source archives

The connected-history ZIP retains its existing source-only format. It includes saved provider observations across the connected history, not an owner-account backup. Local match decisions, bookmarks, Coach sessions and corrections are outside this archive, as they were for the existing owner state.

Imported data is saved as file evidence; its verification metadata cannot establish current provider authority or accepted team-game membership. Derived associations and publications are rebuilt only from currently entitled evidence under the normal matcher rules. Importing sources does not copy another team’s owner decisions or overwrite the destination team’s existing decisions and saved owner state. A genuine source change can still make an existing association require review.

The two focused portable-history tests verify exact before/after destination association, revision, publication, membership, bookmark and correction rows. A fresh target imports the two source observations with file provenance and creates no association, decision or publication. An injected decision section is rejected at manifest admission before any source observation is applied. This is source-history restoration, not matcher-intent portability.
