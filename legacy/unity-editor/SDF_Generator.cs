using UnityEditor;
using UnityEngine;

/// <summary>
///   <para>Ref:</para>
///   <para>1. http://www.codersnotes.com/notes/signed-distance-fields/</para>
///   <para>2. https://shaderfun.com</para>
///   <para>3. https://zhuanlan.zhihu.com/p/337944099</para>
/// </summary>

public class SDF_Generator : EditorWindow
{
    Vector2 scrollPosition;

    struct Pixel
    {
        public float distance;
        public bool edge;
    }
    int m_x_dims;
    int m_y_dims;
    Pixel[] m_pixels;
    int samples;

    // 
    public int targetSize = 256;
    int sampleTimes = 0;
    string outputName;
    [SerializeField]Texture2D[] Sources;
    SerializedProperty m_Sources;
    SerializedObject m_object;
    //

    
    [MenuItem("Window/SDF Generator")]
	public static void ShowWindow ()
	{
		EditorWindow.GetWindow (typeof(SDF_Generator));
	}

    private void OnEnable() {
        ScriptableObject target = this;
        m_object = new SerializedObject(target);
        
    }
    void OnGUI () 
	{
        m_object.Update();
        m_Sources = m_object.FindProperty("Sources");

        scrollPosition = GUILayout.BeginScrollView(scrollPosition,GUILayout.Width(0),GUILayout.Height(0));

        GUILayout.Space (20);
        //Body
        outputName = EditorGUILayout.TextField("Output Name", outputName);
        targetSize = EditorGUILayout.IntField("Target Size", targetSize);
        // samples - posterize
        
        GUI.color = Color.cyan;
        sampleTimes = EditorGUILayout.IntField(sampleTimes>0?"Samples (Posterize)":"Samples (Smooth)", sampleTimes<0? 0:sampleTimes);
        

        GUILayout.Space (10);
        //Explain
		GUI.color = Color.yellow;

        EditorGUILayout.LabelField("● Texture with smaller white area should be on top.", EditorStyles.helpBox);
        GUI.color = Color.white;
        //input textures
        EditorGUILayout.PropertyField(m_Sources, true);
        m_object.ApplyModifiedPropertiesWithoutUndo();
        GUILayout.Space (20);

        if (GUILayout.Button ("Generate!"))
            Generate();
        GUILayout.Space (30);

        GUILayout.EndScrollView();
	}

    public void Generate()
    {
        SaveTexture(Generator(Sources));
    }
    
    void LoadFromTexture(Texture2D texture)
    {
        Color[] texpixels = texture.GetPixels();
        m_x_dims = texture.width;
        m_y_dims = texture.height;
        m_pixels = new Pixel[m_x_dims * m_y_dims];
        for (int i = 0; i < m_pixels.Length; i++)
        {
            if (texpixels[i].r > 0.5f)
                m_pixels[i].distance = -99999f;
            else
                m_pixels[i].distance = 99999f;
        }
    }

    void BuildSweepGrids(out float[] outside_grid, out float[] inside_grid)
    {
        outside_grid = new float[m_pixels.Length];
        inside_grid = new float[m_pixels.Length];
        for (int i = 0; i < m_pixels.Length; i++)
        {
            if (m_pixels[i].distance < 0)
            {
                //inside pixel. outer distance is set to 0, inner distance
                //is preserved (albeit negated to make it positive)
                outside_grid[i] = 0f;
                inside_grid[i] = -m_pixels[i].distance;
            }
            else
            {
                //outside pixel. inner distance is set to 0,
                //outer distance is preserved
                inside_grid[i] = 0f;
                outside_grid[i] = m_pixels[i].distance;
            }
        }
    }

    Texture2D Generator(Texture2D[] source)
    {
        Texture2D dest = new Texture2D(targetSize, targetSize);
        if(source.Length== 0) return dest;

        var pixels_out = new Color[targetSize*targetSize];

        var dists_temp = new float[source.Length, targetSize*targetSize];
        
        // Calculate all the textures and store the results for further calculation
        for(int count = 0; count < source.Length; count++)
        {
            samples = (int)sampleTimes/source.Length;
            LoadFromTexture(source[count]);
            ClearAndMarkNoneEdgePixels();
            float[] outside_grid, inside_grid;
            BuildSweepGrids(out outside_grid, out inside_grid);

            //run the 8PSSEDT sweep on each grid
            SweepGrid(outside_grid);
            SweepGrid(inside_grid);
            
            int scaleX = source[count].width / targetSize;
            int scaleY = source[count].height / targetSize;

            for (int y = 0; y < targetSize; y++)
            {
                for (int x = 0; x < targetSize; x++)
                {
                    int i = y * targetSize + x;
                    float dist1 = inside_grid[y * scaleY * m_x_dims + x * scaleX];
                    float dist2 = outside_grid[y * scaleY * m_x_dims + x * scaleX];
                    var dist = Mathf.Clamp(128f + (dist1 - dist2), 0f, 255f);
                    dist = Mathf.InverseLerp(0f, 255f, dist);
                    dists_temp[count, i] = dist;
                    
                    // One SDF without smooth
                    if (source.Length == 1) pixels_out[i] = new Color(dist, dist, dist, 1f);
                }
            }
        }

        // Smooth using SdF_Smooth function
        float[] dists_intrp = new float[targetSize*targetSize];
        if (source.Length >= 2)
        {
            float gap = 1f/(source.Length - 1);
            for(int count = 0; count < source.Length - 1; count++)
            {
                for (int y = 0; y < targetSize; y++)
                {
                    for (int x = 0; x < targetSize; x++)
                    {
                        int i = y * targetSize + x;
                        dists_intrp[i] += (float)SDF_Smooth(dists_temp[count, i], dists_temp[count+1, i], new Vector2(1f - (count+1)*gap , 1f - count*gap));
                    }
                }
            }

            for (int y = 0; y < targetSize; y++)
            {
                for (int x = 0; x < targetSize; x++)
                {
                    int i = y * targetSize + x;
                    pixels_out[i] = new Color(dists_intrp[i], dists_intrp[i], dists_intrp[i], 1f);
                }
            }
        }
        
        dest.SetPixels(pixels_out);
        dest.Apply();

        return dest;
    }

    //compare a pixel for the sweep, and updates it with a new distance if necessary
    void Compare(float[] grid, int x, int y, int xoffset, int yoffset)
    {
        //calculate the location of the other pixel, and bail if in valid
        int otherx = x + xoffset;
        int othery = y + yoffset;
        if (otherx < 0 || othery < 0 || otherx >= m_x_dims || othery >= m_y_dims)
            return;

        //read the distance values stored in both this and the other pixel
        float curr_dist = grid[y * m_x_dims + x];
        float other_dist = grid[othery * m_x_dims + otherx];

        //calculate a potential new distance, using the one stored in the other pixel,
        //PLUS the distance to the other pixel
        float new_dist = other_dist + Mathf.Sqrt(xoffset * xoffset + yoffset * yoffset);

        //if the potential new distance is better than our current one, update!
        if (new_dist < curr_dist)
            grid[y * m_x_dims + x] = new_dist;
    }

    void SweepGrid(float[] grid)
    {
        // Pass 0
        //loop over rows from top to bottom
        for (int y = 0; y < m_y_dims; y++)
        {
            //loop over pixels from left to right
            for (int x = 0; x < m_x_dims; x++)
            {
                Compare(grid, x, y, -1, 0);
                Compare(grid, x, y, 0, -1);
                Compare(grid, x, y, -1, -1);
                Compare(grid, x, y, 1, -1);
            }

            //loop over pixels from right to left
            for (int x = m_x_dims - 1; x >= 0; x--)
            {
                Compare(grid, x, y, 1, 0);
            }
        }

        // Pass 1
        //loop over rows from bottom to top
        for (int y = m_y_dims - 1; y >= 0; y--)
        {
            //loop over pixels from right to left
            for (int x = m_x_dims - 1; x >= 0; x--)
            {
                Compare(grid, x, y, 1, 0);
                Compare(grid, x, y, 0, 1);
                Compare(grid, x, y, -1, 1);
                Compare(grid, x, y, 1, 1);
            }

            //loop over pixels from left to right
            for (int x = 0; x < m_x_dims; x++)
            {
                Compare(grid, x, y, -1, 0);
            }
        }
    }


    Pixel GetPixel(int x, int y)
    {
        return m_pixels[y * m_x_dims + x];
    }
    void SetPixel(int x, int y, Pixel p)
    {
        m_pixels[y * m_x_dims + x] = p;
    }

    bool IsOuterPixel(int pix_x, int pix_y)
    {
        if (pix_x < 0 || pix_y < 0 || pix_x >= m_x_dims || pix_y >= m_y_dims)
            return true;
        else
            return GetPixel(pix_x, pix_y).distance >= 0;
    }

    bool IsEdgePixel(int pix_x, int pix_y)
    {
        bool is_outer = IsOuterPixel(pix_x, pix_y);
        if (is_outer != IsOuterPixel(pix_x - 1, pix_y - 1)) return true; //[-1,-1]
        if (is_outer != IsOuterPixel(pix_x, pix_y - 1)) return true;     //[ 0,-1]
        if (is_outer != IsOuterPixel(pix_x + 1, pix_y - 1)) return true; //[+1,-1]
        if (is_outer != IsOuterPixel(pix_x - 1, pix_y)) return true;     //[-1, 0]
        if (is_outer != IsOuterPixel(pix_x + 1, pix_y)) return true;     //[+1, 0]
        if (is_outer != IsOuterPixel(pix_x - 1, pix_y + 1)) return true; //[-1,+1]
        if (is_outer != IsOuterPixel(pix_x, pix_y + 1)) return true;     //[ 0,+1]
        if (is_outer != IsOuterPixel(pix_x + 1, pix_y + 1)) return true; //[+1,+1]
        return false;
    }

    public void ClearAndMarkNoneEdgePixels()
    {
        for (int y = 0; y < m_y_dims; y++)
        {
            for (int x = 0; x < m_y_dims; x++)
            {
                Pixel pix = GetPixel(x, y);
                pix.edge = IsEdgePixel(x, y); //mark edge pixels
                if (!pix.edge)
                    pix.distance = pix.distance > 0 ? 99999f : -99999f;
                SetPixel(x, y, pix);
            }
        }
    }

    float SDF_Smooth(float sdfA,float sdfB, Vector2 sdfEdge)
    {
        // Smooth sdf images and define threshold
        if (sdfA < .5f && sdfB < .5f)
        {
            return 0f;
        }
        if (sdfA > .5f && sdfB > .5f)
        {
            if(sdfEdge.y == 1f) return 1f;
            return 0f;
        }

        float result = 0;
        if (samples > 0)
        {
            for (int i = 0; i < samples; i++)
            {
                float t = (float)i/samples; // (float) is needed
                result += Mathf.Lerp(sdfA, sdfB, t) < .5f? sdfEdge.x : sdfEdge.y;
            }
            return result / samples;
        }
        
        float ratio = (sdfA - 0.5f) / (sdfA - sdfB);
        if (sdfA > sdfB)
        {
            result = sdfEdge.y * ratio + sdfEdge.x * (1f - ratio);
        }
        else
        {
            result = sdfEdge.x * ratio + sdfEdge.y * (1f - ratio);
        }
        return result;
    }
    void SaveTexture(Texture2D texture)
    {
        byte[] bytes = texture.EncodeToPNG();
        var dirPath = Application.dataPath.Replace("Assets", "") + AssetDatabase.GetAssetPath(Sources[0]).Replace(Sources[0].name, outputName);
        if (outputName == null || outputName == "")
        {
            //if the output name is blank, fill in the name based on the original texture
            dirPath = Application.dataPath.Replace("Assets", "") + AssetDatabase.GetAssetPath(Sources[0]).Replace(Sources[0].name, Sources[0].name + "_OUT");
        }
        System.IO.File.WriteAllBytes(dirPath, bytes);
        Debug.Log(bytes.Length / 1024 + "Kb was saved as: " + dirPath);
        #if UNITY_EDITOR
        UnityEditor.AssetDatabase.Refresh();
        #endif
    }

}
